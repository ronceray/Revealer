"""Development server: live rebuild, live reload, and the layout editor.

``revealer serve`` watches a ``.pres`` file, rebuilds it on change (as a
separate ``<stem>.dev.html`` artifact — the exported ``<stem>.html`` is never
touched), and pushes reload events to the browser over Server-Sent Events.
Python standard library only.

Design notes:
- The watcher compares a SHA-256 of the ``.pres`` *content*, not its mtime:
  cloud-synced folders (Dropbox, ...) churn mtimes without content changes,
  and editors save atomically (the file can be briefly missing).
- On a build failure the last good HTML keeps being served and the browser
  shows an error overlay; the next successful build clears it.
- The editor assets and the per-session token are injected into the served
  HTML at response time, so the token never touches disk and ``*.dev.html``
  stays inert if opened directly.
- Write access (future edit endpoints) is guarded by a per-session token in a
  custom ``X-RV-Token`` header: a cross-site page cannot set it without a CORS
  preflight, which this server never grants — plus an Origin check.
"""

from __future__ import annotations

import hashlib
import http.server
import json
import os
import queue
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import traceback
import webbrowser
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path

from . import build as build_mod
from . import edit as edit_mod
from . import grammar as grammar_mod

DEV_PREFIX = "/__rv__"

# Ordered editor-script manifest: _inject_dev emits one deferred <script>
# per entry, and _dev_asset serves exactly these names (plus the CSS).
# The P3a decomposition grows this list; order is load order.
EDITOR_JS: tuple[str, ...] = (
    "editor/core.js",
    "editor/i18n.js",
    "editor/net.js",
    "editor/chrome.js",
    "editor/drag.js",
    "editor/blockmove.js",
    "editor/drawer.js",
    "editor/format.js",
    "editor/textsel.js",
    "editor/inline-edit.js",
    "editor/panel.js",
    "editor/templates.js",
    "editor/history.js",
    "editor/outline.js",
    "editor/shell.js",
    "editor/split.js",
    "editor/boot.js",
)
_DEV_ASSETS = frozenset(EDITOR_JS) | {"editor.css"}
SSE_KEEPALIVE_S = 15
WATCH_INTERVAL_S = 0.25
ASSET_SCAN_INTERVAL_S = 1.0

# Media extensions considered "asset only" (reload without rebuild).
_MEDIA_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm",
              ".ogg", ".ogv", ".mov", ".mp3", ".wav", ".pdf"}
# Extensions whose change requires a rebuild (referenced/converted at build
# time): .pdf figures reconvert through Media/.rv-cache, .svg may be inlined.
_REBUILD_EXT = {".bib", ".svg", ".pdf", ".pres"}
# Directories never scanned by the asset watcher.
_SKIP_DIRS = {"reveal.js", ".git", ".rv-history", ".rv-cache", "__pycache__"}


@dataclass
class DevSession:
    pres: Path
    pdir: Path
    token: str
    sha: str = ""            # sha of the last successfully built source
    attempted_sha: str = ""  # sha of the last source a build was attempted on
    html_path: Path | None = None
    build_error: dict | None = None
    clients: list[queue.SimpleQueue] = field(default_factory=list)
    clients_lock: threading.Lock = field(default_factory=threading.Lock)
    lock: threading.RLock = field(default_factory=threading.RLock)
    test_mode: bool = False             # unlocks /__rv__/test (never in normal serve)
    includes: tuple = ()                # files `> include:`d by the last build
    test_results: dict | None = None    # last payload POSTed by the JS runner
    # undo/redo = a cursor over the shadow-git first-parent history.
    cursor: str | None = None            # detached position (None = at HEAD)
    dirty_keep: dict | None = None       # dirty worktree snapshot {"": main, rel: include}
    fallback_undo: bytes | None = None   # single-slot undo when git is unavailable
    history_mode: str = "git"            # "git" | "fallback"
    previews: set = field(default_factory=set)  # generated .rv-preview-* artifacts
    export_job: str | None = None               # id of the running PDF export, if any
    export_cancel: threading.Event | None = None  # its cancel flag


def _sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _broadcast(sess: DevSession, event: dict) -> None:
    payload = json.dumps(event)
    with sess.clients_lock:
        for q in list(sess.clients):
            q.put(payload)


def _rebuild(sess: DevSession, log=print, commit: bool = True) -> bool:
    """Rebuild the dev artifact; on failure keep the last good one."""
    with sess.lock:
        try:
            t0 = time.monotonic()
            sess.attempted_sha = _sha_bytes(sess.pres.read_bytes())
            out = build_mod.build(str(sess.pres), dev=True)
            sess.html_path = Path(out)
            sess.sha = sess.attempted_sha
            sess.build_error = None
            try:
                sess.includes = tuple(build_mod.collect_includes(str(sess.pres)))
            except Exception:
                sess.includes = ()
            log("rebuilt {0} in {1:.0f} ms".format(
                sess.html_path.name, 1000 * (time.monotonic() - t0)))
            if commit:
                try:
                    _history_commit(sess.pdir, sess.pres,
                                    time.strftime("%H:%M:%S"), auto=True,
                                    sess=sess)
                except Exception:
                    pass  # history is best-effort, never blocks a build
            _broadcast(sess, {"type": "reload", "sha": sess.sha})
            return True
        except Exception as exc:
            tb = traceback.format_exc()
            # Best effort: surface a line number if the error message has one.
            m = re.search(r"line (\d+)", str(exc))
            sess.build_error = {
                "message": str(exc),
                "traceback": tb,
                "line": int(m.group(1)) if m else None,
            }
            log("build failed: {0}".format(exc))
            _broadcast(sess, {"type": "build-error", **sess.build_error})
            return False


def _watch(sess: DevSession, stop: threading.Event, log=print) -> None:
    """Poll the .pres content hash (and deck assets) and rebuild on change."""
    last_asset_scan = 0.0
    asset_state: dict[str, float] = {}

    def scan_assets() -> tuple[bool, bool]:
        """Returns (needs_rebuild, needs_reload) based on asset mtimes."""
        rebuild = reload_ = False
        first = not asset_state
        for root, dirs, files in os.walk(sess.pdir):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
            for name in files:
                ext = os.path.splitext(name)[1].lower()
                if ext not in _MEDIA_EXT and ext not in _REBUILD_EXT:
                    continue
                p = os.path.join(root, name)
                if ext == ".pres" and os.path.realpath(p) == str(sess.pres):
                    continue  # the sha loop below owns the main file
                if name.startswith(".rv-preview"):
                    continue  # transient history-preview build inputs/outputs
                try:
                    mt = os.stat(p).st_mtime
                except OSError:
                    continue
                if asset_state.get(p) != mt:
                    asset_state[p] = mt
                    if not first:
                        if ext in _REBUILD_EXT:
                            rebuild = True
                        else:
                            reload_ = True
        return rebuild, reload_

    scan_assets()  # prime the mtime table
    pending_sha: str | None = None

    while not stop.wait(WATCH_INTERVAL_S):
        # --- .pres content (debounced: rebuild once the hash is stable).
        # Compared against the last *attempted* build, so a failing source
        # doesn't retrigger a rebuild storm, and reverting to the exact
        # last-good content still rebuilds (clearing the error overlay).
        try:
            sha = _sha_bytes(sess.pres.read_bytes())
        except FileNotFoundError:
            continue  # atomic save in progress; retry next tick
        if sha != sess.attempted_sha:
            if sha == pending_sha:
                pending_sha = None
                _rebuild(sess, log=log)
            else:
                pending_sha = sha
        else:
            pending_sha = None

        # --- other assets, less often
        now = time.monotonic()
        if now - last_asset_scan >= ASSET_SCAN_INTERVAL_S:
            last_asset_scan = now
            needs_rebuild, needs_reload = scan_assets()
            if needs_rebuild:
                _rebuild(sess, log=log)
            elif needs_reload:
                _broadcast(sess, {"type": "reload", "sha": sess.sha})


def _inject_dev(html: str, sess: DevSession) -> str:
    """Inject the dev bootstrap + editor assets at response time."""
    boot: dict = {"token": sess.token, "history": sess.history_mode}
    if sess.build_error:
        # A page opened while the build is broken shows the overlay right
        # away instead of waiting for the SSE replay.
        boot["buildError"] = sess.build_error
    bootstrap = (
        '<script>window.__RV_DEV__ = {0};</script>\n'
        '<link rel="stylesheet" href="{1}/editor.css">\n'.format(
            json.dumps(boot).replace("</", "<\\/"), DEV_PREFIX)
        + "".join('<script src="{0}/{1}" defer></script>\n'.format(
            DEV_PREFIX, name) for name in EDITOR_JS)
    )
    if "</body>" in html:
        return html.replace("</body>", bootstrap + "</body>", 1)
    return html + bootstrap


HISTORY_DIR = ".rv-history"


def _hgit(pdir: Path, *args: str) -> subprocess.CompletedProcess:
    """Run git against the deck's shadow history repo (raw bytes I/O)."""
    return subprocess.run(
        ["git", "--git-dir", str(pdir / HISTORY_DIR), "--work-tree", str(pdir), *args],
        capture_output=True, timeout=30)


def _hgit_text(pdir: Path, *args: str) -> subprocess.CompletedProcess:
    """Git for display output (log/diff): decoded UTF-8, errors replaced."""
    return subprocess.run(
        ["git", "--git-dir", str(pdir / HISTORY_DIR), "--work-tree", str(pdir), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=30)


def _history_init(pdir: Path) -> bool:
    if (pdir / HISTORY_DIR / "HEAD").exists():
        return True
    if shutil.which("git") is None:
        return False
    ok = _hgit(pdir, "init", "-q").returncode == 0
    if ok:
        _hgit(pdir, "config", "user.name", "revealer")
        _hgit(pdir, "config", "user.email", "revealer@local")
    return ok


def _head_hash(pdir: Path) -> str | None:
    proc = _hgit_text(pdir, "rev-parse", "HEAD")
    return proc.stdout.strip() if proc.returncode == 0 else None


def _blob_bytes(pdir: Path, pres, commit: str) -> bytes | None:
    """Blob bytes of a tracked file at *commit*; *pres* is a Path (its name
    is used) or a repo-relative posix path string (for included files)."""
    if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        return None
    rel = pres.name if isinstance(pres, Path) else str(pres)
    proc = _hgit(pdir, "show", "{0}:{1}".format(commit, rel))
    return proc.stdout if proc.returncode == 0 else None


def _include_rels(sess: DevSession) -> list[str]:
    rels = []
    for inc in sess.includes:
        try:
            rels.append(Path(inc).resolve().relative_to(
                sess.pdir.resolve()).as_posix())
        except ValueError:
            pass
    return rels


def _snapshot_worktree(sess: DevSession) -> dict:
    """Capture the current bytes of the main .pres and every tracked include.

    Used by a dirty undo so an uncommitted edit to ANY file (including a
    non-.pres include the watcher never auto-commits) survives redo.
    """
    snap = {"": sess.pres.read_bytes()}
    for rel in _include_rels(sess):
        try:
            snap[rel] = (sess.pdir / rel).read_bytes()
        except OSError:
            pass
    return snap


def _restore_worktree(sess: DevSession, snap: dict) -> None:
    for rel, data in snap.items():
        target = sess.pres if rel == "" else (sess.pdir / rel)
        try:
            target.write_bytes(data)
        except OSError:
            pass


def _restore_includes(sess: DevSession, commit: str) -> None:
    """Write every tracked include's blob at *commit* (undo spans files)."""
    for rel in _include_rels(sess):
        blob = _blob_bytes(sess.pdir, rel, commit)
        if blob is None:
            continue
        p = sess.pdir / rel
        try:
            if not p.exists() or p.read_bytes() != blob:
                p.write_bytes(blob)
        except OSError:
            pass


def _resolve_edit_file(sess: DevSession, name: str):
    """Map a request's optional ``file`` field to the main .pres or a
    recorded include; None when it names neither (422 at the caller)."""
    if not name or name == sess.pres.name:
        return sess.pres
    target = (sess.pdir / name).resolve()
    for inc in sess.includes:
        if Path(inc).resolve() == target:
            return Path(target)
    return None


def _parent_of(pdir: Path, commit: str) -> str | None:
    proc = _hgit_text(pdir, "rev-parse", commit + "^")
    return proc.stdout.strip() if proc.returncode == 0 else None


def _child_of(pdir: Path, commit: str) -> str | None:
    """The first-parent descendant of *commit* on the HEAD line, if any."""
    proc = _hgit_text(pdir, "rev-list", "--first-parent", "HEAD")
    hashes = proc.stdout.split()
    try:
        i = hashes.index(commit)
    except ValueError:
        return None
    return hashes[i - 1] if i > 0 else None


def _rewind_commit(pdir: Path, cursor: str,
                   message: str = "auto: rewind") -> bool:
    """Append a commit whose tree is the cursor's — history stays linear and
    nothing after the cursor is lost (undo of the undo remains possible)."""
    head = _head_hash(pdir)
    if head is None:
        return False
    tree = _hgit_text(pdir, "rev-parse", cursor + "^{tree}").stdout.strip()
    head_tree = _hgit_text(pdir, "rev-parse", head + "^{tree}").stdout.strip()
    if not tree or tree == head_tree:
        return False
    proc = _hgit_text(pdir, "commit-tree", tree, "-p", head, "-m", message)
    new = proc.stdout.strip()
    if proc.returncode != 0 or not new:
        return False
    return _hgit(pdir, "update-ref", "HEAD", new).returncode == 0


def _history_commit(pdir: Path, pres: Path, message: str, auto: bool,
                    sess: DevSession | None = None) -> bool:
    """Snapshot the .pres (+ .bib files) if anything changed.

    Committing while the undo cursor is detached first appends a rewind
    commit (the cursor's tree), so the new content parents onto what the
    user was actually looking at.
    """
    if not _history_init(pdir):
        return False
    prefix = "auto: " if auto else "save: "
    rewound = False
    if sess is not None and sess.cursor:
        head = _head_hash(pdir)
        if head and sess.cursor != head:
            # a manual save at a detached cursor: the rewind IS the snapshot
            rewound = _rewind_commit(
                pdir, sess.cursor,
                message="auto: rewind" if auto else prefix + message)
    files = [pres.name] + [f.name for f in pdir.glob("*.bib")]
    if sess is not None:
        for inc in sess.includes:
            try:
                files.append(str(Path(inc).resolve().relative_to(pdir.resolve())))
            except ValueError:
                pass  # outside the deck folder — never staged
    _hgit(pdir, "add", "-f", "--", *files)
    committed = False
    if _hgit(pdir, "diff", "--cached", "--quiet").returncode != 0:
        committed = _hgit(pdir, "commit", "-q", "-m",
                          prefix + message).returncode == 0
    if sess is not None and (rewound or committed):
        sess.cursor = None
        sess.dirty_keep = None
    return committed or rewound


def _history_list(pdir: Path, limit: int = 60) -> list[dict]:
    if not (pdir / HISTORY_DIR / "HEAD").exists():
        return []
    proc = _hgit_text(pdir, "log", "--pretty=%H%x00%ct%x00%s", "-{0}".format(limit))
    out = []
    for line in proc.stdout.splitlines():
        parts = line.split("\x00")
        if len(parts) == 3:
            out.append({"hash": parts[0], "ts": int(parts[1]), "msg": parts[2],
                        "auto": parts[2].startswith("auto: ")})
    return out


def _history_show(pdir: Path, pres: Path, commit: str) -> str | None:
    data = _blob_bytes(pdir, pres, commit)
    return data.decode("utf-8", errors="replace") if data is not None else None


def _worktree_matches(sess: DevSession, commit: str) -> bool:
    """Do the main .pres AND every tracked include match *commit*'s blobs?

    P8: an include edit leaves the main file untouched, so position
    resolution must compare the whole fileset — else undo/redo of an
    include-only change looks like "at_head" and redo has nowhere to go.
    """
    try:
        if _blob_bytes(sess.pdir, sess.pres, commit) != sess.pres.read_bytes():
            return False
    except OSError:
        return False
    for rel in _include_rels(sess):
        blob = _blob_bytes(sess.pdir, rel, commit)
        try:
            work = (sess.pdir / rel).read_bytes()
        except OSError:
            work = None
        if blob != work:
            return False
    return True


def _resolve_position(sess: DevSession) -> str:
    """Where the working tree sits relative to history.

    ``no_history`` | ``at_head`` | ``at_cursor`` | ``dirty`` — the working
    bytes (main + includes) are always revalidated; the cursor is never
    trusted blindly.
    """
    if sess.history_mode != "git":
        return "no_history"
    head = _head_hash(sess.pdir)
    if head is None:
        return "no_history"
    try:
        sess.pres.read_bytes()
    except OSError:
        return "no_history"
    if _worktree_matches(sess, head):
        return "at_head"
    if sess.cursor and _worktree_matches(sess, sess.cursor):
        return "at_cursor"
    return "dirty"


def _bib_differs(sess: DevSession, target: str) -> bool:
    """Do the working .bib files differ from *target*'s? (Undo/restore write
    the .pres only; the drawer warns when citations may be out of step.)"""
    for bib in sess.pdir.glob("*.bib"):
        proc = _hgit(sess.pdir, "show", "{0}:{1}".format(target, bib.name))
        blob = proc.stdout if proc.returncode == 0 else None
        if blob != bib.read_bytes():
            return True
    return False


def _open_in_editor(pres: Path, line: int, log=print) -> bool:
    """Open the .pres at a line in the user's editor (best effort).

    ``$REVEALER_EDITOR`` may be a command line with ``{file}`` / ``{line}``
    placeholders (e.g. ``"emacsclient -n +{line} {file}"``); without
    placeholders, ``<file>:<line>`` is appended (VS Code-style ``-g`` syntax
    is used automatically for ``code``).
    """
    import shlex

    line = int(line)
    candidates: list[list[str]] = []
    env_editor = os.environ.get("REVEALER_EDITOR")
    if env_editor:
        parts = shlex.split(env_editor)
        if any("{file}" in p or "{line}" in p for p in parts):
            candidates.append([
                p.replace("{file}", str(pres)).replace("{line}", str(line))
                for p in parts
            ])
        else:
            candidates.append(parts + ["{0}:{1}".format(pres, line)])
    if shutil.which("code"):
        candidates.append(["code", "-g", "{0}:{1}".format(pres, line)])
    for var in ("VISUAL", "EDITOR"):
        ed = os.environ.get(var)
        if ed:
            candidates.append(shlex.split(ed) + ["+{0}".format(line), str(pres)])
    for argv in candidates:
        try:
            subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except OSError:
            continue
    log("no editor found (set $REVEALER_EDITOR)")
    return False


_BUILDING_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Revealer — building…</title></head>
<body style="font-family: sans-serif; padding: 3em;">
<h2>First build failed</h2>
<p>Fix the error below and save — this page reloads automatically.</p>
<pre id="err" style="background:#f6f6f6;padding:1em;white-space:pre-wrap;"></pre>
</body></html>"""


class _Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, sess: DevSession, log=print, **kwargs):
        self.sess = sess
        self._log = log
        super().__init__(*args, directory=str(sess.pdir), **kwargs)

    # --- helpers ----------------------------------------------------------

    _HOST_RE = re.compile(r"^(127\.0\.0\.1|localhost)(:\d+)?$")

    def _check_host(self) -> bool:
        host = self.headers.get("Host", "")
        return bool(self._HOST_RE.match(host))

    def _check_token(self) -> bool:
        origin = self.headers.get("Origin")
        if origin and not re.match(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", origin):
            return False
        supplied = self.headers.get("X-RV-Token") or self._query().get("token", "")
        return secrets.compare_digest(supplied, self.sess.token)

    def _query(self) -> dict:
        from urllib.parse import parse_qs, urlsplit
        q = parse_qs(urlsplit(self.path).query)
        return {k: v[0] for k, v in q.items()}

    def _path_only(self) -> str:
        from urllib.parse import urlsplit
        return urlsplit(self.path).path

    def _send_json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str, code: int = 200) -> None:
        body = html.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # --- routes -----------------------------------------------------------

    def do_HEAD(self):  # noqa: N802
        if not self._check_host():
            self.send_error(403)
            return
        super().do_HEAD()

    def do_GET(self):  # noqa: N802
        if not self._check_host():
            return self._send_json(403, {"error": "bad host"})
        path = self._path_only()

        if path == DEV_PREFIX + "/events":
            return self._sse()
        if path.startswith(DEV_PREFIX + "/") \
                and path[len(DEV_PREFIX) + 1:] in _DEV_ASSETS:
            return self._dev_asset(path[len(DEV_PREFIX) + 1:])
        if path == DEV_PREFIX + "/test":
            return self._test_runner()
        if path.startswith(DEV_PREFIX + "/test/"):
            return self._test_asset(path[len(DEV_PREFIX) + 6:])
        if path == DEV_PREFIX + "/test-results":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            if not self.sess.test_mode:
                self.send_error(404)
                return
            return self._send_json(200, {"results": self.sess.test_results})
        if path == DEV_PREFIX + "/history/diff":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            h = self._query().get("hash", "")
            if not re.fullmatch(r"[0-9a-f]{7,40}", h):
                return self._send_json(400, {"error": "bad hash"})
            proc = _hgit_text(self.sess.pdir, "show", h, "--format=%s",
                              "--patch", "--", self.sess.pres.name)
            return self._send_json(200, {"diff": proc.stdout[:20000]})
        if path == DEV_PREFIX + "/history":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            return self._send_json(200, {
                "entries": _history_list(self.sess.pdir),
                "cursor": self.sess.cursor,
            })
        if path == DEV_PREFIX + "/schema":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            return self._send_json(200, grammar_mod.schema())
        if path == DEV_PREFIX + "/src":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            return self._src_span()
        if path == DEV_PREFIX + "/inspect":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            return self._inspect_span()
        if path == DEV_PREFIX + "/open":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            try:
                line = int(self._query().get("line", "1"))
            except ValueError:
                return self._send_json(400, {"error": "bad line"})
            ok = _open_in_editor(self.sess.pres, line, log=self._log)
            return self._send_json(200 if ok else 500, {"ok": ok})
        if path in ("/", "/index.html"):
            return self._serve_deck()

        return self._serve_static()

    def do_POST(self):  # noqa: N802
        if not self._check_host():
            return self._send_json(403, {"error": "bad host"})
        if not self._check_token():
            return self._send_json(403, {"error": "forbidden"})
        path = self._path_only()
        if path == DEV_PREFIX + "/edit":
            return self._edit()
        if path == DEV_PREFIX + "/export":
            return self._export()
        if path == DEV_PREFIX + "/export/cancel":
            return self._export_cancel()
        if path == DEV_PREFIX + "/history/commit":
            return self._history_snapshot()
        if path == DEV_PREFIX + "/history/restore":
            return self._history_restore()
        if path == DEV_PREFIX + "/history/preview":
            return self._history_preview()
        if path == DEV_PREFIX + "/undo":
            return self._undo_redo(undo=True)
        if path == DEV_PREFIX + "/redo":
            return self._undo_redo(undo=False)
        if path == DEV_PREFIX + "/test-results":
            if not self.sess.test_mode:
                self.send_error(404)
                return
            try:
                self.sess.test_results = json.loads(
                    self._read_body().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return self._send_json(400, {"error": "bad json"})
            return self._send_json(200, {"ok": True})
        return self._send_json(404, {"error": "not found"})

    def do_PUT(self):  # noqa: N802
        if not self._check_host():
            return self._send_json(403, {"error": "bad host"})
        if not self._check_token():
            return self._send_json(403, {"error": "forbidden"})
        if self._path_only() == DEV_PREFIX + "/upload":
            return self._upload()
        return self._send_json(404, {"error": "not found"})

    def _read_body(self, limit: int = 220 * 1024 * 1024) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 0 or length > limit:
            raise ValueError("body too large")
        return self.rfile.read(length)

    def _edit(self) -> None:
        sess = self.sess
        try:
            req = json.loads(self._read_body().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send_json(400, {"error": "bad json"})
        sha = str(req.get("sha256", ""))
        edits = req.get("edits", [])
        if not isinstance(edits, list) or not edits:
            return self._send_json(400, {"error": "no edits"})
        with sess.lock:
            # P8: a batch targets exactly one file — the main .pres by
            # default, or a recorded include named by the `file` field.
            target = _resolve_edit_file(sess, str(req.get("file") or ""))
            if target is None:
                return self._send_json(422, {"error": "unknown_file",
                                             "file": req.get("file")})
            before_text = target.read_text(encoding="utf-8")
            try:
                result = edit_mod.apply_edits(target, sha, edits)
            except edit_mod.EditError as exc:
                return self._send_json(exc.status, exc.payload)
            # Undo state: the rebuild's auto-commit records this edit in the
            # shadow git; without git, keep a single before-image slot
            # (main file only — include edits have no fallback undo).
            if sess.history_mode != "git" and target == sess.pres:
                sess.fallback_undo = before_text.encode("utf-8")
            _rebuild(sess, log=self._log)
            if sess.build_error:
                # The edit produced an unbuildable deck — engine bug or bad op.
                # Roll it back so the user is never stuck on a broken file.
                target.write_text(before_text, encoding="utf-8")
                if target == sess.pres:
                    sess.fallback_undo = None
                _rebuild(sess, log=self._log)
                return self._send_json(422, {
                    "error": "edit_breaks_build",
                    "detail": sess.build_error and sess.build_error.get("message"),
                })
            return self._send_json(200, {"ok": True, "sha256": result["sha256"],
                                         "file": str(req.get("file") or "")})

    def _src_span(self) -> None:
        """Return the .pres source lines of a span (panel display + editing)."""
        q = self._query()
        try:
            start = int(q.get("start", "1"))
            end = int(q.get("end", str(start)))
        except ValueError:
            return self._send_json(400, {"error": "bad range"})
        with self.sess.lock:
            target = _resolve_edit_file(self.sess, q.get("file", ""))
            if target is None:
                return self._send_json(422, {"error": "unknown_file"})
            data = target.read_bytes()
            lines = data.decode("utf-8").replace("\r\n", "\n").split("\n")
            if not (1 <= start <= end <= len(lines)):
                return self._send_json(422, {"error": "line_out_of_range"})
            return self._send_json(200, {
                "sha256": _sha_bytes(data),
                "start": start,
                "end": end,
                "total": len(lines),
                "file": q.get("file", ""),
                "lines": lines[start - 1:end],
            })

    def _inspect_span(self) -> None:
        """Per-line inline source maps (rendered-text <-> source columns).

        Each line yields ``{text, segments}`` where segments is a list of
        ``[start_col, end_col, rendered, kind]`` or null when the mapper
        refused the line (the client hides the bubble there).
        """
        q = self._query()
        try:
            start = int(q.get("start", "1"))
            end = int(q.get("end", str(start)))
        except ValueError:
            return self._send_json(400, {"error": "bad range"})
        with self.sess.lock:
            target = _resolve_edit_file(self.sess, q.get("file", ""))
            if target is None:
                return self._send_json(422, {"error": "unknown_file"})
            data = target.read_bytes()
            lines = data.decode("utf-8").replace("\r\n", "\n").split("\n")
            if not (1 <= start <= end <= len(lines)):
                return self._send_json(422, {"error": "line_out_of_range"})
            out = []
            for n in range(start, end + 1):
                text = lines[n - 1]
                try:
                    segments = build_mod.inline_segments(text)
                except Exception:
                    segments = None  # never 500 over a map — just refuse
                out.append({"line": n, "text": text, "segments": segments})
            return self._send_json(200, {
                "sha256": _sha_bytes(data),
                "start": start,
                "end": end,
                "file": q.get("file", ""),
                "lines": out,
            })

    def _history_snapshot(self) -> None:
        try:
            req = json.loads(self._read_body().decode("utf-8") or "{}")
        except ValueError:
            req = {}
        msg = str(req.get("message") or "manual snapshot")[:200]
        with self.sess.lock:
            ok = _history_commit(self.sess.pdir, self.sess.pres, msg,
                                 auto=False, sess=self.sess)
        return self._send_json(200, {"ok": True, "committed": ok})

    def _history_restore(self) -> None:
        sess = self.sess
        try:
            req = json.loads(self._read_body().decode("utf-8"))
        except ValueError:
            return self._send_json(400, {"error": "bad json"})
        target = str(req.get("hash", ""))
        data = _blob_bytes(sess.pdir, sess.pres, target)
        if data is None:
            return self._send_json(422, {"error": "unknown_version"})
        with sess.lock:
            if _worktree_matches(sess, target):
                return self._send_json(200, {"ok": True, "unchanged": True})
            # the current state is snapshotted first, so a restore never loses
            # work; the rebuild then commits the restored state as a new entry
            # (history stays linear — a restore is itself undoable).
            _history_commit(sess.pdir, sess.pres, "before restore", auto=True,
                            sess=sess)
            sess.pres.write_bytes(data)
            _restore_includes(sess, target)
            sess.dirty_keep = None
            _rebuild(sess, log=self._log)
            return self._send_json(200, {
                "ok": True, "cursor": sess.cursor,
                "bib_differs": _bib_differs(sess, target),
            })

    def _history_preview(self) -> None:
        """Build a historical version as a separate artifact, without touching
        the deck: served at /.rv-preview.html for the peek overlay."""
        sess = self.sess
        try:
            req = json.loads(self._read_body().decode("utf-8"))
        except ValueError:
            return self._send_json(400, {"error": "bad json"})
        text = _history_show(sess.pdir, sess.pres, str(req.get("hash", "")))
        if text is None:
            return self._send_json(422, {"error": "unknown_version"})
        fd, tmp_name = tempfile.mkstemp(prefix=".rv-preview-", suffix=".pres",
                                        dir=str(sess.pdir))
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
            with sess.lock:
                out = build_mod.build(str(tmp))
            sess.previews.add(out)
        except Exception as exc:
            return self._send_json(500, {"error": str(exc)[:300]})
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass
        return self._send_json(200, {"ok": True,
                                     "url": "/" + Path(out).name})

    def _export(self) -> None:
        """Export the deck: kind=html (prod build) or kind=pdf.

        ``kind=pdf&job=1`` runs the export as a cancellable background job:
        it returns ``{job}`` immediately and streams ``export-progress`` /
        ``export-done`` / ``export-cancelled`` / ``export-error`` over SSE.
        Without ``job=1`` the PDF path stays synchronous (returns ``path``).
        """
        sess = self.sess
        q = self._query()
        kind = q.get("kind", "html")
        try:
            with sess.lock:
                html = build_mod.build(str(sess.pres))
            if kind != "pdf":
                return self._send_json(200, {"ok": True, "path": html})
            from . import pdf as pdf_mod

            if q.get("job") == "1":
                return self._start_export_job(html, pdf_mod)

            with sess.lock:
                if sess.export_job is not None:
                    return self._send_json(409, {"error": "export_in_progress",
                                                 "job": sess.export_job})

            def progress(done, total):
                _broadcast(sess, {"type": "export-progress",
                                  "done": done, "total": total})

            out = pdf_mod.export_pdf(html, log=lambda *a: None, progress=progress)
        except Exception as exc:
            return self._send_json(500, {"error": str(exc)})
        return self._send_json(200, {"ok": True, "path": out})

    def _start_export_job(self, html, pdf_mod) -> None:
        """Launch the Chrome render loop in a daemon thread (one at a time)."""
        sess = self.sess
        with sess.lock:
            if sess.export_job is not None:
                return self._send_json(409, {"error": "export_in_progress",
                                             "job": sess.export_job})
            job = secrets.token_hex(8)
            cancel = threading.Event()
            sess.export_job = job
            sess.export_cancel = cancel

        def run():
            def progress(done, total):
                _broadcast(sess, {"type": "export-progress", "job": job,
                                  "done": done, "total": total})
            try:
                out = pdf_mod.export_pdf(html, log=lambda *a: None,
                                         progress=progress,
                                         should_cancel=cancel.is_set)
                _broadcast(sess, {"type": "export-done", "job": job, "path": out})
            except pdf_mod.ExportCancelled:
                _broadcast(sess, {"type": "export-cancelled", "job": job})
            except Exception as exc:  # noqa: BLE001 - surfaced to the client
                _broadcast(sess, {"type": "export-error", "job": job,
                                  "error": str(exc)})
            finally:
                with sess.lock:
                    if sess.export_job == job:
                        sess.export_job = None
                        sess.export_cancel = None

        threading.Thread(target=run, daemon=True).start()
        return self._send_json(200, {"ok": True, "job": job})

    def _export_cancel(self) -> None:
        sess = self.sess
        with sess.lock:
            job, cancel = sess.export_job, sess.export_cancel
        if cancel is None:
            return self._send_json(200, {"ok": True, "idle": True})
        cancel.set()
        return self._send_json(200, {"ok": True, "job": job})

    def _undo_redo(self, undo: bool) -> None:
        """Walk the undo cursor over shadow-git history.

        The working bytes are revalidated against the blob at the claimed
        position every time, so hand edits are picked up (and become
        undoable) rather than refused.
        """
        sess = self.sess
        kind = "undo" if undo else "redo"
        with sess.lock:
            if sess.history_mode != "git":
                if not undo or sess.fallback_undo is None:
                    return self._send_json(409, {"error": "nothing_to_" + kind})
                data = sess.pres.read_bytes()
                sess.pres.write_bytes(sess.fallback_undo)
                sess.fallback_undo = data  # swap: a second undo re-does
                _rebuild(sess, log=self._log)
                return self._send_json(200, {"ok": True, "sha256": sess.sha,
                                             "cursor": None})
            pos = _resolve_position(sess)
            if pos == "no_history":
                return self._send_json(409, {"error": "nothing_to_" + kind})
            head = _head_hash(sess.pdir)
            if undo:
                if pos == "dirty":
                    # unbuilt/hand-edited state: keep the WHOLE worktree aside
                    # (main + includes), step to HEAD
                    target = head
                    sess.dirty_keep = _snapshot_worktree(sess)
                    new_cursor = None
                else:
                    base = sess.cursor if pos == "at_cursor" else head
                    target = _parent_of(sess.pdir, base)
                    if target is None:
                        return self._send_json(409, {"error": "nothing_to_undo"})
                    new_cursor = target
            else:
                if pos == "at_cursor":
                    target = _child_of(sess.pdir, sess.cursor)
                    if target is None:
                        return self._send_json(409, {"error": "nothing_to_redo"})
                    new_cursor = None if target == head else target
                elif pos == "at_head" and sess.dirty_keep is not None:
                    snap, sess.dirty_keep = sess.dirty_keep, None
                    sess.cursor = None
                    _restore_worktree(sess, snap)
                    _rebuild(sess, log=self._log, commit=False)
                    return self._send_json(200, {
                        "ok": True, "sha256": sess.sha, "cursor": None,
                        "bib_differs": False})
                else:
                    return self._send_json(409, {"error": "nothing_to_redo"})
            data = _blob_bytes(sess.pdir, sess.pres, target)
            if data is None:
                return self._send_json(409, {"error": "nothing_to_" + kind})
            sess.pres.write_bytes(data)
            _restore_includes(sess, target)
            sess.cursor = new_cursor
            _rebuild(sess, log=self._log, commit=False)
            return self._send_json(200, {
                "ok": True, "sha256": sess.sha, "cursor": sess.cursor,
                "bib_differs": _bib_differs(sess, target),
            })

    _UPLOAD_ROUTES = {
        "Images": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"},
        "Movies": {".mp4", ".webm", ".ogv", ".mov"},
        "Audio": {".mp3", ".wav", ".ogg"},
    }

    _IMAGE_MAGIC = {
        ".png": (b"\x89PNG",),
        ".jpg": (b"\xff\xd8\xff",),
        ".jpeg": (b"\xff\xd8\xff",),
        ".gif": (b"GIF8",),
        ".webp": (b"RIFF",),
    }
    _IMAGE_CAP = 50 * 1024 * 1024

    def _upload(self) -> None:
        sess = self.sess
        name = os.path.basename(self._query().get("name", "")).strip()
        ext = os.path.splitext(name)[1].lower()
        allowed = set().union(*self._UPLOAD_ROUTES.values()) | {".pdf"}
        if not name or ext not in allowed:
            return self._send_json(400, {"error": "bad name", "name": name})
        try:
            body = self._read_body()
        except ValueError:
            return self._send_json(413, {"error": "too large"})
        if len(body) > self._IMAGE_CAP:
            return self._send_json(413, {"error": "too large"})
        magic = self._IMAGE_MAGIC.get(ext)
        if magic is not None and not any(body.startswith(m) for m in magic):
            return self._send_json(400, {"error": "content does not match extension"})
        media = sess.pdir / "Media"
        dest_dir = media
        for sub, exts in self._UPLOAD_ROUTES.items():
            if ext in exts:
                # Subdirectory routing now always applies (created on demand) —
                # a documented behavior change from the exists-only routing.
                dest_dir = media / sub
                break
        with sess.lock:
            dest_dir.mkdir(parents=True, exist_ok=True)
            stem, suffix = os.path.splitext(name)
            dest = dest_dir / name
            n = 1
            while True:
                try:
                    with open(dest, "xb") as f:  # O_EXCL: no TOCTOU
                        f.write(body)
                    break
                except FileExistsError:
                    dest = dest_dir / "{0}-{1}{2}".format(stem, n, suffix)
                    n += 1
        rel = dest.relative_to(sess.pdir).as_posix()
        return self._send_json(200, {"ok": True, "path": rel})

    # --- implementations ----------------------------------------------------

    def _serve_deck(self) -> None:
        sess = self.sess
        if sess.html_path is None or not sess.html_path.is_file():
            return self._send_html(_BUILDING_PAGE, 200)
        html = sess.html_path.read_text(encoding="utf-8")
        self._send_html(_inject_dev(html, sess))

    def _test_runner(self) -> None:
        """The in-browser JS test runner page (P3a harness); dev-tests only.

        Load order matters: rvt.js first (its EventSource stub must precede
        the editor boot), then the dev bootstrap, the editor manifest, the
        suites, and finally the run trigger.
        """
        if not self.sess.test_mode:
            self.send_error(404)
            return
        tdir = Path(__file__).parent / "data" / "js" / "test"
        suites = sorted(p.name for p in tdir.glob("suite-*.js"))
        boot = {"token": self.sess.token, "history": self.sess.history_mode}
        head = [
            "<!doctype html><html><head><meta charset='utf-8'>",
            "<title>rv tests</title>",
            '<script src="{0}/test/rvt.js"></script>'.format(DEV_PREFIX),
            "<script>window.__RV_DEV__ = {0};</script>".format(
                json.dumps(boot).replace("</", "<\\/")),
            '<link rel="stylesheet" href="{0}/editor.css">'.format(DEV_PREFIX),
        ]
        head += ['<script src="{0}/{1}" defer></script>'.format(DEV_PREFIX, n)
                 for n in EDITOR_JS]
        head += ['<script src="{0}/test/{1}" defer></script>'.format(DEV_PREFIX, n)
                 for n in suites]
        head.append("<script>window.addEventListener('load', function () {"
                    " RVT.run(); });</script>")
        head.append("</head><body></body></html>")
        self._send_html("\n".join(head))

    def _test_asset(self, name: str) -> None:
        """Serve a runner-support script; test mode only, names locked down."""
        if not self.sess.test_mode or not re.fullmatch(r"[\w.-]+\.js", name):
            self.send_error(404)
            return
        src = Path(__file__).parent / "data" / "js" / "test" / name
        if not src.is_file():
            self.send_error(404)
            return
        body = src.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _dev_asset(self, name: str) -> None:
        src = Path(__file__).parent / "data" / "js" / name
        if name not in _DEV_ASSETS or not src.is_file():
            self.send_error(404)
            return
        body = src.read_bytes()
        self.send_response(200)
        ctype = "text/css" if name.endswith(".css") else "application/javascript"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _sse(self) -> None:
        if not self._check_token():
            return self._send_json(403, {"error": "forbidden"})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        q: queue.SimpleQueue = queue.SimpleQueue()
        with self.sess.clients_lock:
            self.sess.clients.append(q)
        # If the last build failed, tell the newcomer immediately.
        if self.sess.build_error:
            q.put(json.dumps({"type": "build-error", **self.sess.build_error}))
        try:
            while True:
                try:
                    payload = q.get(timeout=SSE_KEEPALIVE_S)
                    self.wfile.write("data: {0}\n\n".format(payload).encode())
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with self.sess.clients_lock:
                if q in self.sess.clients:
                    self.sess.clients.remove(q)

    def _serve_static(self) -> None:
        """Static files, with single-Range support for media (video seeking)."""
        rng = self.headers.get("Range")
        path = self.translate_path(self._path_only())
        ext = os.path.splitext(path)[1].lower()
        if rng and ext in _MEDIA_EXT and os.path.isfile(path):
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if m:
                size = os.path.getsize(path)
                start = int(m.group(1)) if m.group(1) else None
                end = int(m.group(2)) if m.group(2) else None
                if start is None:  # suffix range: last N bytes
                    start = max(0, size - (end or 0))
                    end = size - 1
                else:
                    end = min(end if end is not None else size - 1, size - 1)
                if start <= end < size:
                    self.send_response(206)
                    self.send_header("Content-Type", self.guess_type(path))
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range",
                                     "bytes {0}-{1}/{2}".format(start, end, size))
                    self.send_header("Content-Length", str(end - start + 1))
                    self.end_headers()
                    with open(path, "rb") as f:
                        f.seek(start)
                        remaining = end - start + 1
                        while remaining > 0:
                            chunk = f.read(min(65536, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    return
        super().do_GET()

    def end_headers(self):
        # Cheap revalidation for everything the parent handler serves.
        if self._path_only() not in ("/", "/index.html"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 — quiet the request spam
        pass


def start_for_tests(pres: Path, test_mode: bool = False, log=lambda *a: None):
    """Start a serving thread on an ephemeral port: no watcher, no browser.

    Returns ``(port, sess, shutdown)``. The pytest seam for HTTP-level and
    (with ``test_mode=True``) in-browser JS tests.
    """
    httpd, sess, stop = create_server(pres, port=0, watch=False, log=log)
    sess.test_mode = test_mode
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    def shutdown():
        stop.set()
        httpd.shutdown()
        thread.join(timeout=5)

    return httpd.server_address[1], sess, shutdown


def create_server(pres: Path, port: int = 8000, watch: bool = True, log=print):
    """Build once and construct the HTTP server (test seam; does not block).

    Returns ``(httpd, sess, stop_event)``. ``port=0`` binds an ephemeral port.
    """
    pres = Path(pres).resolve()
    sess = DevSession(pres=pres, pdir=pres.parent,
                      token=secrets.token_urlsafe(24),
                      history_mode="git" if shutil.which("git") else "fallback")

    _rebuild(sess, log=log)  # first build (failure tolerated: error page served)

    handler = partial(_Handler, sess=sess, log=log)
    httpd = None
    ports = [0] if port == 0 else range(port, port + 21)
    for p in ports:
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", p), handler)
            break
        except OSError:
            continue
    if httpd is None:
        raise RuntimeError("no free port in {0}-{1}".format(port, port + 20))
    httpd.daemon_threads = True

    stop = threading.Event()
    if watch:
        watcher = threading.Thread(target=_watch, args=(sess, stop, log), daemon=True)
        watcher.start()
    return httpd, sess, stop


def serve(pres: Path, port: int = 8000, open_browser: bool = True, log=print) -> None:
    """Entry point: build once, then serve with watch + live reload."""
    httpd, sess, stop = create_server(pres, port=port, watch=True, log=log)
    port = httpd.server_address[1]

    url = "http://127.0.0.1:{0}/".format(port)
    log("serving {0}".format(pres.name))
    log("watching for changes — press Ctrl+C to stop")
    log("→ {0}".format(url))
    if open_browser:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        httpd.server_close()
        for stray in list(sess.previews) + [str(p) for p in sess.pdir.glob(".rv-preview*")]:
            try:
                Path(stray).unlink()
            except OSError:
                pass
        if sess.html_path is not None and sess.html_path.is_file():
            try:
                sess.html_path.unlink()
            except OSError:
                pass
        log("stopped.")

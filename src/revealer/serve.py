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
import threading
import time
import traceback
import webbrowser
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path

from . import build as build_mod
from . import edit as edit_mod

DEV_PREFIX = "/__rv__"
SSE_KEEPALIVE_S = 15
WATCH_INTERVAL_S = 0.25
ASSET_SCAN_INTERVAL_S = 1.0

# Media extensions considered "asset only" (reload without rebuild).
_MEDIA_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm",
              ".ogg", ".ogv", ".mov", ".mp3", ".wav", ".pdf"}
# Extensions whose change requires a rebuild (referenced at build time).
_REBUILD_EXT = {".bib", ".svg"}


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
    # undo/redo journals: full before-images (sha_before, text_before, sha_after)
    journal: list[tuple[str, str, str]] = field(default_factory=list)
    redo: list[tuple[str, str, str]] = field(default_factory=list)


def _sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _broadcast(sess: DevSession, event: dict) -> None:
    payload = json.dumps(event)
    with sess.clients_lock:
        for q in list(sess.clients):
            q.put(payload)


def _rebuild(sess: DevSession, log=print) -> bool:
    """Rebuild the dev artifact; on failure keep the last good one."""
    with sess.lock:
        try:
            t0 = time.monotonic()
            sess.attempted_sha = _sha_bytes(sess.pres.read_bytes())
            out = build_mod.build(str(sess.pres), dev=True)
            sess.html_path = Path(out)
            sess.sha = sess.attempted_sha
            sess.build_error = None
            log("rebuilt {0} in {1:.0f} ms".format(
                sess.html_path.name, 1000 * (time.monotonic() - t0)))
            try:
                _history_commit(sess.pdir, sess.pres,
                                time.strftime("%H:%M:%S"), auto=True)
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
            dirs[:] = [d for d in dirs if d not in ("reveal.js", ".git")]
            for name in files:
                ext = os.path.splitext(name)[1].lower()
                if ext not in _MEDIA_EXT and ext not in _REBUILD_EXT:
                    continue
                p = os.path.join(root, name)
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
    boot: dict = {"token": sess.token}
    if sess.build_error:
        # A page opened while the build is broken shows the overlay right
        # away instead of waiting for the SSE replay.
        boot["buildError"] = sess.build_error
    bootstrap = (
        '<script>window.__RV_DEV__ = {0};</script>\n'
        '<link rel="stylesheet" href="{1}/editor.css">\n'
        '<script src="{1}/editor.js" defer></script>\n'.format(
            json.dumps(boot).replace("</", "<\\/"), DEV_PREFIX)
    )
    if "</body>" in html:
        return html.replace("</body>", bootstrap + "</body>", 1)
    return html + bootstrap


HISTORY_DIR = ".rv-history"


def _hgit(pdir: Path, *args: str) -> subprocess.CompletedProcess:
    """Run git against the deck's shadow history repo (never its own .git)."""
    return subprocess.run(
        ["git", "--git-dir", str(pdir / HISTORY_DIR), "--work-tree", str(pdir), *args],
        capture_output=True, text=True, timeout=30)


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


def _history_commit(pdir: Path, pres: Path, message: str, auto: bool) -> bool:
    """Snapshot the .pres (+ .bib files) if anything changed."""
    if not _history_init(pdir):
        return False
    files = [pres.name] + [f.name for f in pdir.glob("*.bib")]
    _hgit(pdir, "add", "-f", "--", *files)
    if _hgit(pdir, "diff", "--cached", "--quiet").returncode == 0:
        return False  # nothing new
    prefix = "auto: " if auto else "save: "
    return _hgit(pdir, "commit", "-q", "-m", prefix + message).returncode == 0


def _history_list(pdir: Path, limit: int = 60) -> list[dict]:
    if not (pdir / HISTORY_DIR / "HEAD").exists():
        return []
    proc = _hgit(pdir, "log", "--pretty=%H%x00%ct%x00%s", "-{0}".format(limit))
    out = []
    for line in proc.stdout.splitlines():
        parts = line.split("\x00")
        if len(parts) == 3:
            out.append({"hash": parts[0], "ts": int(parts[1]), "msg": parts[2],
                        "auto": parts[2].startswith("auto: ")})
    return out


def _history_show(pdir: Path, pres: Path, commit: str) -> str | None:
    if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        return None
    proc = _hgit(pdir, "show", "{0}:{1}".format(commit, pres.name))
    return proc.stdout if proc.returncode == 0 else None


def _open_in_editor(pres: Path, line: int, log=print) -> bool:
    """Open the .pres at a line in the user's editor (best effort)."""
    line = int(line)
    candidates: list[list[str]] = []
    env_editor = os.environ.get("REVEALER_EDITOR")
    if env_editor:
        candidates.append([env_editor, "-g", "{0}:{1}".format(pres, line)])
    if shutil.which("code"):
        candidates.append(["code", "-g", "{0}:{1}".format(pres, line)])
    for var in ("VISUAL", "EDITOR"):
        ed = os.environ.get(var)
        if ed:
            candidates.append([ed, "+{0}".format(line), str(pres)])
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

    def do_GET(self):  # noqa: N802
        path = self._path_only()

        if path == DEV_PREFIX + "/events":
            return self._sse()
        if path in (DEV_PREFIX + "/editor.js", DEV_PREFIX + "/editor.css"):
            return self._dev_asset(path.rsplit("/", 1)[1])
        if path == DEV_PREFIX + "/history/diff":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            h = self._query().get("hash", "")
            if not re.fullmatch(r"[0-9a-f]{7,40}", h):
                return self._send_json(400, {"error": "bad hash"})
            proc = _hgit(self.sess.pdir, "show", h, "--format=%s", "--patch",
                         "--", self.sess.pres.name)
            return self._send_json(200, {"diff": proc.stdout[:20000]})
        if path == DEV_PREFIX + "/history":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            return self._send_json(200, {"entries": _history_list(self.sess.pdir)})
        if path == DEV_PREFIX + "/src":
            if not self._check_token():
                return self._send_json(403, {"error": "forbidden"})
            return self._src_span()
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
        if not self._check_token():
            return self._send_json(403, {"error": "forbidden"})
        path = self._path_only()
        if path == DEV_PREFIX + "/edit":
            return self._edit()
        if path == DEV_PREFIX + "/export":
            return self._export()
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
        return self._send_json(404, {"error": "not found"})

    def do_PUT(self):  # noqa: N802
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
            before_text = sess.pres.read_text()
            try:
                result = edit_mod.apply_edits(sess.pres, sha, edits)
            except edit_mod.EditError as exc:
                return self._send_json(exc.status, exc.payload)
            # To undo: the file must still carry the new sha; restore the old text.
            sess.journal.append((result["sha256"], before_text, sha))
            del sess.journal[:-200]
            sess.redo.clear()
            _rebuild(sess, log=self._log)
            if sess.build_error:
                # The edit produced an unbuildable deck — engine bug or bad op.
                # Roll it back so the user is never stuck on a broken file.
                sess.pres.write_text(before_text)
                sess.journal.pop()
                _rebuild(sess, log=self._log)
                return self._send_json(422, {
                    "error": "edit_breaks_build",
                    "detail": sess.build_error and sess.build_error.get("message"),
                })
            return self._send_json(200, {"ok": True, "sha256": result["sha256"]})

    def _src_span(self) -> None:
        """Return the .pres source lines of a span (panel display + editing)."""
        q = self._query()
        try:
            start = int(q.get("start", "1"))
            end = int(q.get("end", str(start)))
        except ValueError:
            return self._send_json(400, {"error": "bad range"})
        with self.sess.lock:
            data = self.sess.pres.read_bytes()
            lines = data.decode("utf-8").replace("\r\n", "\n").split("\n")
            if not (1 <= start <= end <= len(lines)):
                return self._send_json(422, {"error": "line_out_of_range"})
            return self._send_json(200, {
                "sha256": _sha_bytes(data),
                "start": start,
                "end": end,
                "lines": lines[start - 1:end],
            })

    def _history_snapshot(self) -> None:
        try:
            req = json.loads(self._read_body().decode("utf-8") or "{}")
        except ValueError:
            req = {}
        msg = str(req.get("message") or "manual snapshot")[:200]
        ok = _history_commit(self.sess.pdir, self.sess.pres, msg, auto=False)
        return self._send_json(200, {"ok": True, "committed": ok})

    def _history_restore(self) -> None:
        sess = self.sess
        try:
            req = json.loads(self._read_body().decode("utf-8"))
        except ValueError:
            return self._send_json(400, {"error": "bad json"})
        text = _history_show(sess.pdir, sess.pres, str(req.get("hash", "")))
        if text is None:
            return self._send_json(422, {"error": "unknown_version"})
        with sess.lock:
            before = sess.pres.read_text()
            if before == text:
                return self._send_json(200, {"ok": True, "unchanged": True})
            # the current state is snapshotted first, so a restore never loses work
            _history_commit(sess.pdir, sess.pres, "before restore", auto=True)
            before_sha = _sha_bytes(before.encode("utf-8"))
            sess.pres.write_text(text)
            new_sha = _sha_bytes(text.encode("utf-8"))
            sess.journal.append((new_sha, before, before_sha))
            del sess.journal[:-200]
            sess.redo.clear()
            _rebuild(sess, log=self._log)
            return self._send_json(200, {"ok": True})

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
        tmp = sess.pdir / ".rv-preview.pres"
        try:
            tmp.write_text(text)
            out = build_mod.build(str(tmp))
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
        """Export the deck: kind=html (prod build) or kind=pdf."""
        kind = self._query().get("kind", "html")
        try:
            if kind == "pdf":
                from . import pdf as pdf_mod
                out = pdf_mod.export_pdf(str(self.sess.pres), log=lambda *a: None)
            else:
                out = build_mod.build(str(self.sess.pres))
        except Exception as exc:
            return self._send_json(500, {"error": str(exc)})
        return self._send_json(200, {"ok": True, "path": out})

    def _undo_redo(self, undo: bool) -> None:
        sess = self.sess
        with sess.lock:
            stack = sess.journal if undo else sess.redo
            other = sess.redo if undo else sess.journal
            if not stack:
                return self._send_json(409, {"error": "nothing_to_" + ("undo" if undo else "redo")})
            expect_sha, restore_text, restore_sha = stack[-1]
            data = sess.pres.read_bytes()
            current_sha = _sha_bytes(data)
            if current_sha != expect_sha:
                return self._send_json(409, {
                    "error": "external_edit",
                    "detail": "the file changed outside the editor; use your editor's undo",
                })
            stack.pop()
            current_text = data.decode("utf-8")
            sess.pres.write_text(restore_text)
            other.append((restore_sha, current_text, current_sha))
            _rebuild(sess, log=self._log)
            return self._send_json(200, {"ok": True, "sha256": sess.sha})

    _UPLOAD_ROUTES = {
        "Images": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"},
        "Movies": {".mp4", ".webm", ".ogv", ".mov"},
        "Audio": {".mp3", ".wav", ".ogg"},
    }

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
        media = sess.pdir / "Media"
        dest_dir = media
        for sub, exts in self._UPLOAD_ROUTES.items():
            if ext in exts and (media / sub).is_dir():
                dest_dir = media / sub
                break
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem, suffix = os.path.splitext(name)
        dest = dest_dir / name
        n = 1
        while dest.exists():
            dest = dest_dir / "{0}-{1}{2}".format(stem, n, suffix)
            n += 1
        dest.write_bytes(body)
        rel = dest.relative_to(sess.pdir).as_posix()
        return self._send_json(200, {"ok": True, "path": rel})

    # --- implementations ----------------------------------------------------

    def _serve_deck(self) -> None:
        sess = self.sess
        if sess.html_path is None or not sess.html_path.is_file():
            return self._send_html(_BUILDING_PAGE, 200)
        html = sess.html_path.read_text()
        self._send_html(_inject_dev(html, sess))

    def _dev_asset(self, name: str) -> None:
        src = Path(__file__).parent / "data" / "js" / name
        if not src.is_file():
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


def serve(pres: Path, port: int = 8000, open_browser: bool = True, log=print) -> None:
    """Entry point: build once, then serve with watch + live reload."""
    pres = Path(pres).resolve()
    sess = DevSession(pres=pres, pdir=pres.parent,
                      token=secrets.token_urlsafe(24))

    _rebuild(sess, log=log)  # first build (failure tolerated: error page served)

    handler = partial(_Handler, sess=sess, log=log)
    httpd = None
    for p in range(port, port + 21):
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", p), handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        raise RuntimeError("no free port in {0}-{1}".format(port, port + 20))
    httpd.daemon_threads = True

    stop = threading.Event()
    watcher = threading.Thread(target=_watch, args=(sess, stop, log), daemon=True)
    watcher.start()

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
        for stray in (sess.pdir / ".rv-preview.html", sess.pdir / ".rv-preview.pres"):
            try:
                stray.unlink()
            except OSError:
                pass
        if sess.html_path is not None and sess.html_path.is_file():
            try:
                sess.html_path.unlink()
            except OSError:
                pass
        log("stopped.")

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
        # Edit endpoints land in a later stage; the guard rails are in place.
        if not self._check_token():
            return self._send_json(403, {"error": "forbidden"})
        return self._send_json(501, {"error": "not implemented"})

    do_PUT = do_POST  # noqa: N815

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
        if sess.html_path is not None and sess.html_path.is_file():
            try:
                sess.html_path.unlink()
            except OSError:
                pass
        log("stopped.")

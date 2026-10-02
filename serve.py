#!/usr/bin/env python3
"""Serve Jigsta's Web/ folder. Usage: python3 serve.py [port] [bind]

Same as `python3 -m http.server`, plus `Cache-Control: no-cache`: without it browsers
heuristically cache the scripts and keep running stale code after an edit. no-cache still
lets them reuse files via cheap 304 revalidation.
"""
import functools
import http.server
import pathlib
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5777
bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
web = pathlib.Path(__file__).resolve().parent / "Web"
handler = functools.partial(Handler, directory=str(web))
with http.server.ThreadingHTTPServer((bind, port), handler) as httpd:
    print(f"Jigsta on http://{bind}:{port}", flush=True)
    httpd.serve_forever()

#!/usr/bin/env python3
"""Local server: static files from public/ plus the API, like Vercel's routing."""
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))

from index import handler  # noqa: E402


class DevHandler(handler, SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return handler.do_GET(self)
        if path == "/admin":
            self.path = "/admin.html"
        return SimpleHTTPRequestHandler.do_GET(self)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    bound = functools.partial(DevHandler, directory=os.path.join(ROOT, "public"))
    ThreadingHTTPServer(("127.0.0.1", port), bound).serve_forever()

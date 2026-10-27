#!/usr/bin/env python3
"""Static file server for local development, with caching disabled.

`python -m http.server` sends only Last-Modified, so browsers happily reuse
cached JS/CSS — which means a code fix can silently never reach the page.
This server always answers 200 with `Cache-Control: no-store` and ignores
conditional requests, so every reload really reloads.

Usage:  python3 serve.py [port] [directory]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # lets us confirm in DevTools which build is actually live
        self.send_header("X-Served-By", "liberty-dev-server")
        super().end_headers()

    def send_head(self):
        # drop conditional headers so the client never gets a 304
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    directory = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    handler = partial(NoCacheHandler, directory=directory)
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"serving {directory} on http://0.0.0.0:{port} (no-cache)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

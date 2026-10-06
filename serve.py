"""Local static server for the game (correct MIME types on Windows, no caching)."""
import http.server, functools, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
                      '.html': 'text/html', '.glb': 'model/gltf-binary', '.json': 'application/json',
                      '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('', PORT), functools.partial(Handler, directory=ROOT)).serve_forever()

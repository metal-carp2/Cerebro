"""Dependency-free NeuroFlow companion service.

Runs a development inference endpoint on the local network. Replace
`predict()` backends with validated PyTorch/ONNX BIOT, LaBraM, or EEGPT models.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse, json, math, time

def predict(payload):
    rows = payload.get("samples", [])
    flattened = [float(value) for row in rows[-128:] for value in row]
    energy = sum(value * value for value in flattened) / max(1, len(flattened))
    score = max(0.0, min(1.0, math.tanh(math.sqrt(energy) / 25.0)))
    return {"score": score, "label": "active" if score >= .5 else "rest", "backend": "companion-demo"}

class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self): self._send(200, {})
    def do_GET(self):
        if self.path in ("/", "/health"): self._send(200, {"name": "NeuroFlow Companion", "version": "0.1.0", "backends": ["companion-demo"], "models": ["focus", "relax"], "status": "ready"})
        else: self._send(404, {"error": "not found"})
    def do_POST(self):
        if self.path != "/infer": return self._send(404, {"error": "not found"})
        try:
            size = int(self.headers.get("content-length", "0")); payload = json.loads(self.rfile.read(size)); started = time.perf_counter(); result = predict(payload); result["serverMs"] = round((time.perf_counter() - started) * 1000, 3); self._send(200, result)
        except Exception as exc: self._send(400, {"error": str(exc)})
    def log_message(self, fmt, *args): print("[companion]", fmt % args)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--host", default="0.0.0.0"); parser.add_argument("--port", type=int, default=8765); args = parser.parse_args()
    print(f"NeuroFlow Companion listening on http://{args.host}:{args.port}")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()

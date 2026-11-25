from __future__ import annotations

import os
import socket
import threading
import time
import urllib.request
import webbrowser

import uvicorn

from backend.main import app


def _pick_port(preferred: int = 8000) -> int:
    for port in (preferred, 8080, 7860, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return int(sock.getsockname()[1])
            except OSError:
                continue
    return 8000


def _open_browser_when_ready(url: str) -> None:
    health_url = f"{url}/healthz"
    for _ in range(40):
        try:
            with urllib.request.urlopen(health_url, timeout=0.5) as resp:
                if resp.status == 200:
                    webbrowser.open(url)
                    return
        except Exception:
            time.sleep(0.2)
    webbrowser.open(url)


def main() -> None:
    preferred = int(os.getenv("OPENCITE_PORT", "8000"))
    port = _pick_port(preferred)
    url = f"http://127.0.0.1:{port}"

    print("=" * 54)
    print("  OpenCite — Local Citation Graph")
    print(f"  Running at: {url}")
    print("  Close this window or press Ctrl+C to stop.")
    print("=" * 54)

    if os.getenv("OPENCITE_NO_BROWSER") != "1":
        threading.Thread(
            target=_open_browser_when_ready, args=(url,), daemon=True
        ).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()

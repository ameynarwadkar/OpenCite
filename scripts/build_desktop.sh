#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Building TypeScript frontend..."
(cd frontend && npm ci && npm run build)

echo "[2/3] Building standalone OpenCite binary with PyInstaller..."
pyinstaller --noconfirm --onefile --name OpenCite \
  --add-data "frontend/dist:frontend/dist" \
  --add-data "static:static" \
  --hidden-import "uvicorn.logging" \
  --hidden-import "uvicorn.loops.auto" \
  --hidden-import "uvicorn.protocols.http.auto" \
  --hidden-import "uvicorn.lifespan.on" \
  launcher.py

echo "[3/3] Done! Standalone binary created in dist/OpenCite"

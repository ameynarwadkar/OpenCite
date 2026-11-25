# Build a standalone Windows executable (dist/OpenCite.exe)
$ErrorActionPreference = "Stop"

Write-Host "[1/3] Building TypeScript frontend..." -ForegroundColor Cyan
Push-Location frontend
npm ci
npm run build
Pop-Location

Write-Host "[2/3] Building OpenCite.exe with PyInstaller..." -ForegroundColor Cyan
uv run --no-project --with pyinstaller --with fastapi --with uvicorn --with httpx --with pymupdf --with python-multipart --with pydantic `
  pyinstaller --noconfirm --onefile --name OpenCite `
  --add-data "frontend/dist;frontend/dist" `
  --add-data "static;static" `
  --hidden-import "uvicorn.logging" `
  --hidden-import "uvicorn.loops.auto" `
  --hidden-import "uvicorn.protocols.http.auto" `
  --hidden-import "uvicorn.lifespan.on" `
  launcher.py

Write-Host "[3/3] Done! Standalone executable created at: dist\OpenCite.exe" -ForegroundColor Green

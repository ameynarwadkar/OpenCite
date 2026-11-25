# Stage 1: Build TypeScript + Vite frontend
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python FastAPI runtime (Hugging Face Spaces / Render / Railway compatible)
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

RUN useradd -m -u 1000 user

COPY pyproject.toml ./
COPY backend/ ./backend/
COPY static/ ./static/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir . && \
    chown -R user:user /app

USER user
EXPOSE 7860

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860}"]

# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
# Client-side API key embedded in the public JS bundle at build time.
# Restrict via Google Cloud Console (HTTP referrer restrictions), not by hiding it.
ARG VITE_GOOGLE_MAPS_API_KEY
RUN npm run build

# Stage 2: Python backend + frontend static files
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir -r requirements.txt && \
    addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

COPY --chown=appuser:appgroup backend/ ./
COPY --chown=appuser:appgroup --from=frontend-build /app/frontend/build ./static

# Pre-create the default uploads directory so the non-root runtime user can
# write task / project / portal attachments. ``/app`` is owned by root, so
# without this the first upload fails with EACCES when it tries to
# ``mkdir /app/uploads``. Container-local storage is ephemeral — set the
# ``UPLOAD_DIR`` env var to a mounted-volume path for persistent attachments.
RUN mkdir -p /app/uploads && chown appuser:appgroup /app/uploads

# NOTE: we intentionally do NOT ``USER appuser`` here. Railway mounts
# volumes as root regardless of the Dockerfile USER directive, so
# ``UPLOAD_DIR=/data/uploads`` would come up root-owned and the app
# couldn't write to it. The entrypoint runs as root only long enough to
# ``chown`` the mounted volume to appuser, then drops privileges and
# ``exec``s uvicorn — so the long-running server process is never root.
EXPOSE 8080
CMD ["python", "docker-entrypoint.py"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:${PORT:-8080}/api/v1/health || exit 1

# =====================================================================
#  WAPI - FastAPI REST API
#  Multi-stage build (build context = project root):
#      docker compose up -d
# =====================================================================

# --- Stage 1: build the admin dashboard (React + Vite) -------------------
FROM node:20-alpine AS dashboard-build
WORKDIR /dash
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

# --- Stage 2: Python runtime --------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY fastapi/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fastapi/app ./app
COPY fastapi/app.py .

# Admin dashboard (built in stage 1). main.py looks for
# <project_root>/dashboard/dist, i.e. /app/dashboard/dist in the container.
COPY --from=dashboard-build /dash/dist ./dashboard/dist

RUN mkdir -p /app/logs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health', timeout=5);print('ok')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

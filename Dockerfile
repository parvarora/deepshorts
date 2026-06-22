# Root-level on purpose: the backend reads prompts/ and directors/ as siblings of
# backend/ (see backend/app/config.py), so the build context must be the repo root,
# not backend/ alone. This lets `gcloud run deploy --source .` (from repo root) just work.

FROM python:3.11-slim
WORKDIR /srv

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/app backend/app
COPY prompts prompts
COPY directors directors

# Cloud Run injects $PORT (default 8080) and requires binding 0.0.0.0.
ENV PORT=8080
EXPOSE 8080

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --app-dir /srv/backend

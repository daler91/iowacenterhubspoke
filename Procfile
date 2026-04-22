web: uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --timeout-graceful-shutdown 15
worker: arq worker.WorkerSettings

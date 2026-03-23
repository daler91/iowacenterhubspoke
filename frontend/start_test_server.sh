#!/bin/bash
cd /app/backend
uvicorn server:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

cd /app/frontend
yarn install
yarn dev &
FRONTEND_PID=$!

echo $BACKEND_PID > /tmp/backend.pid
echo $FRONTEND_PID > /tmp/frontend.pid

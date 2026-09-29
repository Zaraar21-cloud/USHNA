# Stage 1: build the dashboard
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# the dashboard imports the trained-model reports from ushna/ml/artifacts
COPY ushna/ml/artifacts/*.json /app/ushna/ml/artifacts/
RUN npm run build

# Stage 2: edge node = API + MQTT bridge + physics + built dashboard
FROM python:3.11-slim
WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt
COPY ushna/ ushna/
COPY api/ api/
COPY src/ src/
COPY --from=frontend /app/frontend/dist/ /app/frontend/dist/
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Dedicated Dockerfile for USHNA React Frontend Dashboard
# Stage 1: Build dashboard
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci

# Copy frontend source and ML model artifacts required for building
WORKDIR /app
COPY frontend/ ./frontend/
COPY ushna/ml/artifacts/*.json ./ushna/ml/artifacts/

WORKDIR /app/frontend
RUN npm run build

# Stage 2: Serve built assets using NGINX
FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

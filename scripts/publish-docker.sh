#!/bin/bash

# Configuration
# Replace 'padetta' with your Docker Hub username if different
DOCKER_USER=${1:-padetta}
VERSION=${2:-latest}

echo "🚀 Preparing to build and push images for user: $DOCKER_USER (Tag: $VERSION)"

# 1. Setup Docker Buildx (for multi-platform support: amd64 + arm64)
# This ensures your image works on both Mac M1/M2 and standard Linux servers
echo "🛠  Setting up Docker Buildx..."
docker buildx create --use --name portfolio-builder --node portfolio-builder0 || true

# 2. Build and Push Backend
echo "📦 Building Backend..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t "$DOCKER_USER/portfolio-backend:$VERSION" \
  ./backend

if [ $? -eq 0 ]; then
    echo "✅ Backend pushed successfully!"
else
    echo "❌ Backend build failed!"
    exit 1
fi

# 3. Build and Push Frontend
echo "📦 Building Frontend..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t "$DOCKER_USER/portfolio-frontend:$VERSION" \
  ./frontend

if [ $? -eq 0 ]; then
    echo "✅ Frontend pushed successfully!"
else
    echo "❌ Frontend build failed!"
    exit 1
fi

echo "🎉 All images pushed!"
echo "---------------------------------------------------"
echo "To let others use your app, share 'docker-compose.prod.yml' and tell them to run:"
echo "export DOCKER_USER=$DOCKER_USER"
echo "docker compose -f docker-compose.prod.yml up -d"

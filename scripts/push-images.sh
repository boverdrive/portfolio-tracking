#!/bin/bash
set -e

# Define colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Multi-Arch Build & Push...${NC}"

# Ensure buildx builder exists and is selected
if ! docker buildx inspect multiarch > /dev/null 2>&1; then
    echo "Creating new builder 'multiarch'..."
    docker buildx create --name multiarch --use
    docker buildx inspect --bootstrap
else
    echo "Using existing 'multiarch' builder..."
    docker buildx use multiarch
fi

echo -e "${GREEN}1. Building Backend (linux/amd64, linux/arm64)...${NC}"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t boverdrive/portfolio-backend:latest \
  --push \
  backend

echo -e "${GREEN}2. Building Yahoo Finance Service (linux/amd64, linux/arm64)...${NC}"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t boverdrive/yahoo-finance:latest \
  --push \
  yahoo-finance

echo -e "${GREEN}3. Building Frontend (linux/amd64, linux/arm64)...${NC}"
# Note: Passing NEXT_PUBLIC_API_URL default, but runtime config (env.js) makes this flexible.
# We still pass localhost because the build process might need a valid URL structure.
docker buildx build --platform linux/amd64,linux/arm64 \
  -t boverdrive/portfolio-frontend:latest \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 \
  --push \
  frontend

echo -e "${GREEN}All images built and pushed successfully!${NC}"

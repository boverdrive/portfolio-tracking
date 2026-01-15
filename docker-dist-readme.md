# 🐳 Docker Distribution (For Developers)

## 1. Build and Publish Images
To share this application with others, you can build and push Docker images to Docker Hub (or GHCR).
We include a script that uses `docker buildx` to build for both AMD64 (Linux servers) and ARM64 (Mac M1/M2).

```bash
# Login to Docker Hub first
docker login

# Run the publish script (default user: padetta)
./scripts/publish-docker.sh YOUR_DOCKERHUB_USERNAME
```

## 2. How Others Can Run It
Give them the `docker-compose.prod.yml` file and tell them to run:

```bash
# Set the username environment variable (optional if defaults match)
export DOCKER_USER=YOUR_DOCKERHUB_USERNAME

# Start the stack using pre-built images
docker compose -f docker-compose.prod.yml up -d
```

This will download the images from Docker Hub and start the app without needing to build source code.

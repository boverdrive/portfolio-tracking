FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for pandas/numpy compilation)
# RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ /app/src/

# Set Python path to include src
ENV PYTHONPATH=/app/src

# Expose port
EXPOSE 8000

# Run the server
CMD ["uvicorn", "server_http:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

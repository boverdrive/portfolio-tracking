FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for pandas/numpy compilation)
# RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ /app/src/

# Set Python path to include src
ENV PYTHONPATH=/app/src

# Configuration defaults (can be overridden at runtime)
ENV YAHOO_FINANCE_HOST=0.0.0.0
ENV YAHOO_FINANCE_PORT=8000
ENV YAHOO_FINANCE_LOG_LEVEL=INFO

# Expose port (documentation only, actual port set by env)
EXPOSE 8000

# Run the server using environment variables
CMD uvicorn server_http:app --host $YAHOO_FINANCE_HOST --port $YAHOO_FINANCE_PORT --workers 1

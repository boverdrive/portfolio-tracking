# Build stage
FROM rust:bookworm AS builder

WORKDIR /app

# Install build dependencies (openssl, etc.)
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev cmake && \
    rm -rf /var/lib/apt/lists/*

# Copy source code
COPY . .

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install OpenSSL (required by many Rust crates) and ca-certificates
RUN apt-get update && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/target/release/portfolio-backend /app/portfolio-backend

# Expose port
EXPOSE 3001

# Run the binary
CMD ["/app/portfolio-backend"]

# Build stage
FROM rust:1.81-bookworm as builder

WORKDIR /app

# Copy dependency files first to cache dependencies
COPY Cargo.toml Cargo.lock ./

# Create dummy src/main.rs to build dependencies
RUN mkdir src && \
    echo "fn main() {println!(\"if you see this, the build broke\")}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy source code
COPY . .

# Build the application
# We touch src/main.rs to force rebuild of the application code
RUN touch src/main.rs && \
    cargo build --release

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

# Build stage
FROM rust:bookworm AS builder

WORKDIR /app

# Install build dependencies (openssl, etc.)
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev cmake && \
    rm -rf /var/lib/apt/lists/*

# Copy manifest files to cache dependencies
COPY Cargo.toml Cargo.lock ./

# Create a dummy main.rs to build dependencies
RUN mkdir src && \
    echo "fn main() {println!(\"if you see this, the build broke\")}" > src/main.rs

# Build dependencies only (release mode)
RUN cargo build --release

# Remove the dummy build artifacts so the real code allows a fresh build
# We need to remove the binary and the specific package dependency info
RUN rm src/*.rs && \
    rm -f target/release/deps/portfolio_backend*

# Copy actual source code
COPY src ./src

# Build the application
# modifying the main file timestamp to ensure rebuild
RUN touch src/main.rs && cargo build --release

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

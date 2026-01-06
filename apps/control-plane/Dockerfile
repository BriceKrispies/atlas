FROM rust:latest AS chef
RUN cargo install cargo-chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps ./apps
COPY tools ./tools
COPY tests ./tests
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies - this layer is cached
RUN cargo chef cook --release --recipe-path recipe.json

# Copy source code
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps ./apps
COPY tools ./tools
COPY tests ./tests

# Build application
RUN cargo build --release -p atlas-platform-control-plane

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/control-plane /usr/local/bin/control-plane

ENV RUST_LOG=info
ENV PORT=8000

EXPOSE 8000

CMD ["control-plane"]

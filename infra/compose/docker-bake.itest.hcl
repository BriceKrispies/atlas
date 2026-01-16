// Docker Bake file for Atlas Platform integration test builds
//
// Usage:
//   docker buildx bake -f infra/compose/docker-bake.itest.hcl --progress=plain
//
// Benefits over docker compose build:
// - Parallel builds across all targets
// - Shared cache between builds (cargo-chef recipe is shared)
// - Better progress visualization
// - More efficient layer reuse

variable "CARGO_FEATURES_INGRESS" {
  default = "test-auth"
}

// Default group builds all application services
group "default" {
  targets = ["control-plane", "ingress", "workers"]
}

// Shared settings for all Rust builds
// Note: context is "." because bake is run from project root via pushd
target "_rust-base" {
  context = "."
  // Uses Docker's default build cache (BuildKit inline cache)
}

target "control-plane" {
  inherits   = ["_rust-base"]
  dockerfile = "apps/control-plane/Dockerfile"
  tags       = ["atlas-platform-control-plane:itest"]
}

target "ingress" {
  inherits   = ["_rust-base"]
  dockerfile = "infra/docker/Dockerfile.ingress"
  tags       = ["atlas-platform-ingress:itest"]
  args = {
    CARGO_FEATURES = "${CARGO_FEATURES_INGRESS}"
  }
}

target "workers" {
  inherits   = ["_rust-base"]
  dockerfile = "infra/docker/Dockerfile.workers"
  tags       = ["atlas-platform-workers:itest"]
}

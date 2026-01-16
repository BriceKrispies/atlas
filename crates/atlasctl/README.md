# atlasctl

Controller client for the Atlas Platform.

`atlasctl` is the operator/controller client for interacting with a running Atlas deployment. It communicates exclusively over HTTP with the ingress service and control plane API.

## Installation

Build from the workspace root:

```bash
cargo build -p atlasctl --release
```

The binary will be at `target/release/atlasctl`.

For development:

```bash
cargo run -p atlasctl -- <command>
```

## Usage

```bash
atlasctl --help
```

### Global Options

| Option | Env Variable | Default | Description |
|--------|--------------|---------|-------------|
| `--base-url` | `ATLAS_BASE_URL` | `http://localhost:3000` | Ingress service URL |
| `--timeout-ms` | `ATLAS_TIMEOUT_MS` | `30000` | Request timeout |
| `--output` | - | `json` | Output format (`json` or `table`) |

### Commands

#### Status

Check service health:

```bash
atlasctl status
atlasctl status --base-url http://localhost:3000
```

#### Invoke Intent

Submit an intent to the platform:

```bash
# With inline JSON
atlasctl invoke TestAction \
  --tenant tenant-001 \
  --data '{"actionId": "Test.Action", "resourceType": "Resource"}'

# With JSON file
atlasctl invoke TestAction \
  --tenant tenant-001 \
  --data @payload.json

# With debug principal (test mode only)
atlasctl invoke TestAction \
  --tenant tenant-001 \
  --as user:123:tenant-001 \
  --data '{"actionId": "Test.Action", "resourceType": "Resource"}'

# With explicit IDs
atlasctl invoke TestAction \
  --tenant tenant-001 \
  --data @payload.json \
  --correlation-id my-corr-id \
  --idempotency-key my-idem-key
```

The payload must include `actionId` and `resourceType` fields for authorization.

#### Actions List (Not Yet Implemented)

```bash
atlasctl actions list
```

Returns an error with a pointer to the spec for the required endpoint.

#### Trace (Not Yet Implemented)

```bash
atlasctl trace <correlation-id>
```

Returns an error with a pointer to the spec for the required endpoint.

## Authentication

When the ingress service is compiled with `test-auth` feature and `TEST_AUTH_ENABLED=true`, you can use the `--as` flag to inject a debug principal:

```bash
atlasctl invoke TestAction --as user:123 --data '...'
atlasctl invoke TestAction --as user:456:tenant-xyz --data '...'
```

Format: `type:id` or `type:id:tenant_id`

In production, real authentication (JWT, API key) is required.

## Specification

See [specs/crosscut/atlasctl.md](../../specs/crosscut/atlasctl.md) for the full specification including:

- Architectural constraints
- Invariants
- API surface expectations
- Compatibility requirements

## Design Principles

1. **HTTP client only**: No direct database access, no server runtime linking
2. **Full AuthN/AuthZ**: Subject to same policies as other clients
3. **Correlation propagation**: All requests include correlation IDs
4. **Schema conformance**: Payloads conform to published contracts

/**
 * The dev-stack table. This is the data that collapses the four
 * near-identical compose lifecycles the Makefile used to hand-roll
 * (db / obs / keycloak / smtp).
 *
 * Each stack names its compose file, the service(s) to bring up, the
 * readiness probe (if any), and the operator-facing URLs. Lifecycle verbs
 * (up/down/status/logs/reset/wait) are generic over this table — see
 * lifecycle.ts.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root: scripts/dev → ../.. */
export const REPO_ROOT = resolve(HERE, '..', '..');

function composeFile(name: string): string {
  return join(REPO_ROOT, 'infra', 'compose', name);
}

/** Readiness probe applied by the `wait` verb (and `up`'s post-step). */
export type WaitProbe =
  | { kind: 'pg-isready'; user: string; db: string }
  | { kind: 'container-health' }
  | { kind: 'none' };

export interface StackDef {
  /** Lookup key + CLI token. */
  name: string;
  /** Absolute path to the compose file. */
  composeFile: string;
  /**
   * Services to target on `up`. Empty = whole file. `db` lists `postgres`
   * explicitly because the compose file still carries a profile-less,
   * Rust-era `control-plane` service that `build:`s a deleted Dockerfile —
   * `up -d` (unscoped) would try to build it under podman-compose.
   */
  upServices: ReadonlyArray<string>;
  /** Primary container (for single-container health/logs). */
  containerName?: string;
  /** Env injected into compose for this stack (e.g. POSTGRES_*). */
  composeEnv?: Readonly<Record<string, string>>;
  /** Readiness probe. */
  wait: WaitProbe;
  /** Operator-facing URLs, printed after `up` / on `status`. */
  urls: ReadonlyArray<string>;
  /** Optional note printed after `up` (e.g. migration behavior). */
  note?: string;
}

export const STACKS: ReadonlyArray<StackDef> = [
  {
    name: 'db',
    composeFile: composeFile('compose.control-plane.yml'),
    upServices: ['postgres'],
    containerName: 'atlas-platform-control-plane-db',
    composeEnv: {
      POSTGRES_DB: 'control_plane',
      POSTGRES_USER: 'atlas_platform',
      POSTGRES_PASSWORD: 'local_dev_password',
    },
    wait: { kind: 'pg-isready', user: 'atlas_platform', db: 'control_plane' },
    urls: ['Postgres: postgres://atlas_platform:local_dev_password@localhost:15433/control_plane'],
    note: 'Migrations run automatically when @atlas/server boots (apps/server/src/bootstrap.ts). For a seeded dev tenant, run `pnpm dev:up`.',
  },
  {
    name: 'keycloak',
    composeFile: composeFile('compose.keycloak.yml'),
    upServices: [],
    containerName: 'atlas-keycloak',
    wait: { kind: 'container-health' },
    urls: [
      'Admin Console: http://localhost:8081/admin (admin/admin)',
      'Issuer (on atlas-dev net): http://keycloak:8080/realms/<realm>',
    ],
  },
  {
    name: 'obs',
    composeFile: composeFile('compose.observability.yml'),
    upServices: [],
    wait: { kind: 'none' },
    urls: [
      'Grafana:    http://localhost:3001 (anonymous admin)',
      'Prometheus: http://localhost:9090',
      'Loki:       http://localhost:3100',
    ],
  },
  {
    name: 'smtp',
    composeFile: composeFile('compose.smtp4dev.yml'),
    upServices: [],
    containerName: 'atlas-dev-smtp4dev',
    wait: { kind: 'none' },
    urls: ['SMTP listener: localhost:1025', 'Web UI + API: http://localhost:5080'],
    note: 'Requires the external `atlas-dev` network (created by compose.keycloak.yml/compose.dev.yml, or `podman network create atlas-dev`).',
  },
];

export function findStack(name: string): StackDef | undefined {
  return STACKS.find(function match(s) {
    return s.name === name;
  });
}

export function stackNames(): string[] {
  return STACKS.map(function name(s) {
    return s.name;
  });
}

/**
 * Service-alias → container-name map for the cross-stack `logs` command.
 * Points at the LIVE dev containers (the old logs.sh targeted the stale,
 * Rust-era itest stack — deliberately not carried over).
 */
export const LOG_ALIASES: Readonly<Record<string, string>> = {
  db: 'atlas-platform-control-plane-db',
  postgres: 'atlas-platform-control-plane-db',
  pgadmin: 'atlas-platform-pgadmin',
  keycloak: 'atlas-keycloak',
  kc: 'atlas-keycloak',
  prometheus: 'atlas-platform-prometheus',
  grafana: 'atlas-platform-grafana',
  loki: 'atlas-platform-loki',
  promtail: 'atlas-platform-promtail',
  smtp: 'atlas-dev-smtp4dev',
  smtp4dev: 'atlas-dev-smtp4dev',
};

export function resolveContainer(alias: string): string | undefined {
  return LOG_ALIASES[alias];
}

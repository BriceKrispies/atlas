#!/usr/bin/env tsx
/**
 * atlas-cluster — Phase 0 operator CLI for the Compute cluster registry.
 *
 * Connects directly to `CONTROL_PLANE_DB_URL` and reads/writes
 * `control_plane.clusters`. No connectivity probe, no node provisioning — the
 * operator is trusted (same posture as `scripts/atlas-domain.ts`). Subsequent
 * Compute capabilities read the registered cluster and act on it.
 *
 * Register/disable are idempotent (I3): re-registering an existing id is a
 * no-op; disabling an already-disabled (or unknown) id is a no-op.
 *
 * Usage:
 *   pnpm cluster:register <id> <name> <endpoint> --kubeconfig <path>
 *   pnpm cluster:register <id> <name> <endpoint> --token <token> [--region <r>]
 *   pnpm cluster:list
 *   pnpm cluster:disable <id>
 *
 * Requires CONTROL_PLANE_DB_URL. See
 * specs/domains/compute/cluster/capabilities/cluster-registration/README.md
 */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  PostgresClusterStore,
  runMigrations,
} from '../adapters/node/src/index.ts';
import type { ClusterAuthKind } from '../ports/src/index.ts';

function usage(): never {
  process.stderr.write(
    [
      'usage:',
      '  pnpm cluster:register <id> <name> <endpoint> --kubeconfig <path>',
      '  pnpm cluster:register <id> <name> <endpoint> --token <token> [--region <r>]',
      '  pnpm cluster:list',
      '  pnpm cluster:disable <id>',
      '',
      'Requires CONTROL_PLANE_DB_URL.',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

/** Read a repeated/optional `--flag value` pair out of an argv tail. */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) usage();
  return v;
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env['CONTROL_PLANE_DB_URL'];
  if (!url) {
    process.stderr.write('CONTROL_PLANE_DB_URL not set\n');
    process.exit(2);
  }
  const sql = postgres(url, { max: 2 });
  try {
    // Idempotent — re-runs are no-ops once the table exists.
    await runMigrations(sql, 'control-plane');
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cmdRegister(rest: string[]): Promise<void> {
  const [clusterId, name, endpoint, ...flags] = rest;
  if (!clusterId || !name || !endpoint) usage();
  const kubeconfigPath = flagValue(flags, '--kubeconfig');
  const token = flagValue(flags, '--token');
  const region = flagValue(flags, '--region');
  if ((kubeconfigPath && token) || (!kubeconfigPath && !token)) {
    process.stderr.write('exactly one of --kubeconfig <path> or --token <token> is required\n');
    process.exit(2);
  }
  const authKind: ClusterAuthKind = kubeconfigPath ? 'kubeconfig' : 'token';
  const authSecret = kubeconfigPath
    ? await readFile(kubeconfigPath, 'utf8')
    : (token as string);

  await withSql(async function (sql) {
    const store = new PostgresClusterStore(sql);
    const existing = await store.get(clusterId);
    await store.add({
      clusterId,
      name,
      endpoint,
      authKind,
      authSecret,
      ...(region !== undefined ? { region } : {}),
    });
    if (existing) {
      process.stdout.write(`· ${clusterId} already registered (no-op)\n`);
    } else {
      process.stdout.write(`✔ registered: ${clusterId} → ${endpoint} (auth=${authKind})\n`);
    }
  });
}

async function cmdList(): Promise<void> {
  await withSql(async function (sql) {
    const store = new PostgresClusterStore(sql);
    const rows = await store.list();
    if (rows.length === 0) {
      process.stdout.write('(no clusters registered)\n');
      return;
    }
    for (const r of rows) {
      const region = r.region ? ` region=${r.region}` : '';
      process.stdout.write(`  ${r.clusterId}  ${r.endpoint} (${r.status}, auth=${r.authKind})${region}\n`);
    }
  });
}

async function cmdDisable(rest: string[]): Promise<void> {
  const clusterId = rest[0];
  if (!clusterId) usage();
  await withSql(async function (sql) {
    const store = new PostgresClusterStore(sql);
    await store.disable(clusterId);
    process.stdout.write(`✔ disabled: ${clusterId}\n`);
  });
}

const [, , subcommand, ...rest] = process.argv;
switch (subcommand) {
  case 'register':
    await cmdRegister(rest);
    break;
  case 'list':
    await cmdList();
    break;
  case 'disable':
    await cmdDisable(rest);
    break;
  default:
    usage();
}

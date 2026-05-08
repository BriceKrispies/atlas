#!/usr/bin/env tsx
/**
 * atlasctl — operator/controller client for Atlas. Phase A scope per
 * specs/crosscut/atlasctl.md: --version, health, intents validate, intents
 * submit, plus global flags and credential precedence.
 *
 * Architectural constraint: this package MUST NOT import from apps/server,
 * apps/projection-worker, modules/*, adapters/*, ports, or policy-* —
 * enforced by test/deps-check.test.ts (INV-CTL-01).
 */
import { Command } from 'commander';
import { loadConfig, defaultConfigPath } from './config.ts';
import { resolveCredential, AuthError } from './auth.ts';
import { newCorrelationId } from './correlation.ts';
import { runVersion } from './commands/version.ts';
import { runHealth } from './commands/health.ts';
import { runValidate } from './commands/intents/validate.ts';
import { runSubmit } from './commands/intents/submit.ts';
import { runPush } from './commands/push.ts';
import { runRepoList, runRepoShow, runRepoDownload } from './commands/repo.ts';
import type { OutputFlags } from './output.ts';
import type { ClientOptions } from './client.ts';

interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
  apiKey?: string;
  token?: string;
  debugPrincipal?: string;
  correlationId?: string;
  strict?: boolean;
  force?: boolean;
  endpoint?: string;
  config?: string;
  tenant?: string;
  debug?: boolean;
}

function buildClient(opts: GlobalOpts): ClientOptions {
  const cfgPath = opts.config ?? defaultConfigPath();
  const config = loadConfig(cfgPath);
  const credential = resolveCredential(
    {
      apiKey: opts.apiKey,
      token: opts.token,
      debugPrincipal: opts.debugPrincipal,
    },
    {
      ATLAS_API_KEY: process.env['ATLAS_API_KEY'],
      ATLAS_TOKEN: process.env['ATLAS_TOKEN'],
      ATLAS_DEBUG_PRINCIPAL: process.env['ATLAS_DEBUG_PRINCIPAL'],
    },
    config,
  );
  const endpoint =
    opts.endpoint ??
    process.env['ATLAS_ENDPOINT'] ??
    config.endpoint ??
    'http://localhost:3000';
  const correlationId = opts.correlationId ?? newCorrelationId();
  return { endpoint, credential, correlationId };
}

function flags(opts: GlobalOpts): OutputFlags {
  return { json: opts.json === true, quiet: opts.quiet === true };
}

async function main(argv: string[]): Promise<number> {
  // Pre-empt --version / -V before commander handles it, so we can produce
  // structured output that respects --json / --quiet (per spec Version
  // Display — Phase A).
  if (argv.includes('--version') || argv.includes('-V')) {
    runVersion({
      json: argv.includes('--json'),
      quiet: argv.includes('--quiet'),
    });
    return 0;
  }

  const program = new Command();
  program
    .name('atlasctl')
    .description('Atlas operator/controller client (Phase A)')
    .option('--json', 'emit JSON to stdout')
    .option('--quiet', 'suppress non-essential output')
    .option('--api-key <key>', 'API key credential (overrides env + config)')
    .option('--token <token>', 'OIDC bearer token (overrides env + config)')
    .option(
      '--debug-principal <value>',
      'X-Debug-Principal value, format type:id[:tenantId] e.g. "user:tester:dev-tenant" (test-auth bypass; server must have TEST_AUTH_ENABLED=true)',
    )
    .option('--correlation-id <id>', 'use this correlationId instead of generating one')
    .option('--strict', 'treat server warnings as errors (Phase B; reserved in Phase A)')
    .option('--force', 'proceed despite version mismatch (Phase B; no-op in Phase A)')
    .option('--endpoint <url>', 'ingress endpoint (default http://localhost:3000)')
    .option('--config <path>', `config file (default ${defaultConfigPath()})`)
    .option('--tenant <id>', 'tenantId to stamp on synthesized intent envelopes (push). Falls back to ATLAS_TENANT_ID env or the third component of --debug-principal.')
    .option('--debug', 'print per-step correlationIds to stderr')
    .helpOption('-h, --help', 'display help');

  let exitCode = 0;
  const opts = (): GlobalOpts => program.opts() as GlobalOpts;

  program
    .command('version')
    .description('display client + schema-contract + build metadata (Phase A: client-only)')
    .action(() => {
      runVersion(flags(opts()));
    });

  program
    .command('health')
    .description('query ingress liveness + readiness (GET /healthz, GET /readyz)')
    .action(async () => {
      try {
        const client = buildClient(opts());
        exitCode = await runHealth(client, flags(opts()));
      } catch (e) {
        printSetupError(e, flags(opts()).json);
        exitCode = 2;
      }
    });

  const intents = program.command('intents').description('intent operations');

  intents
    .command('validate <file>')
    .description('validate an intent envelope locally against the bundled schemas (use `-` for stdin)')
    .action((file: string) => {
      exitCode = runValidate({ file }, flags(opts()));
    });

  intents
    .command('submit <file>')
    .description('submit an intent envelope to ingress (use `-` for stdin)')
    .action(async (file: string) => {
      try {
        const client = buildClient(opts());
        exitCode = await runSubmit(
          client,
          { file, strict: opts().strict === true },
          flags(opts()),
        );
      } catch (e) {
        printSetupError(e, flags(opts()).json);
        exitCode = 2;
      }
    });

  program
    .command('push <dir>')
    .description(
      'tar.gz a directory and push it as a Repository revision (Repository.Create + Repository.Upload)',
    )
    .option('--repo <slug>', 'repository slug (default: directory basename)')
    .option('--name <name>', 'human-readable name (default: slug)')
    .option('--description <description>', 'optional description')
    .action(
      async (
        dir: string,
        cmdOpts: {
          repo?: string;
          name?: string;
          description?: string;
        },
      ) => {
        try {
          const g = opts();
          const client = buildClient(g);
          const tenantId =
            g.tenant ??
            process.env['ATLAS_TENANT_ID'] ??
            tenantFromDebugPrincipal(
              g.debugPrincipal ?? process.env['ATLAS_DEBUG_PRINCIPAL'],
            ) ??
            undefined;
          exitCode = await runPush(
            client,
            {
              dir,
              repoSlug: cmdOpts.repo,
              name: cmdOpts.name,
              description: cmdOpts.description,
              tenantId,
              debug: g.debug === true,
            },
            flags(g),
          );
        } catch (e) {
          printSetupError(e, flags(opts()).json);
          exitCode = 2;
        }
      },
    );

  const repo = program.command('repo').description('repository read commands');

  repo
    .command('list')
    .description('list repositories visible to this principal (GET /api/v1/repositories)')
    .action(async () => {
      try {
        const client = buildClient(opts());
        exitCode = await runRepoList(client, flags(opts()));
      } catch (e) {
        printSetupError(e, flags(opts()).json);
        exitCode = 2;
      }
    });

  repo
    .command('show <slug>')
    .description('show repository detail (GET /api/v1/repositories/:repoId)')
    .action(async (slug: string) => {
      try {
        const client = buildClient(opts());
        exitCode = await runRepoShow(client, slug, flags(opts()));
      } catch (e) {
        printSetupError(e, flags(opts()).json);
        exitCode = 2;
      }
    });

  repo
    .command('download <slug>')
    .description('download a revision tarball to disk')
    .option('--revision <id>', 'revision id (default: latest)')
    .option('--out <path>', 'output path or directory (default: <slug>-<revisionId>.tar.gz in cwd)')
    .action(
      async (
        slug: string,
        cmdOpts: { revision?: string; out?: string },
      ) => {
        try {
          const client = buildClient(opts());
          exitCode = await runRepoDownload(
            client,
            slug,
            cmdOpts.revision,
            cmdOpts.out,
            flags(opts()),
          );
        } catch (e) {
          printSetupError(e, flags(opts()).json);
          exitCode = 2;
        }
      },
    );

  await program.parseAsync(argv);
  return exitCode;
}

function tenantFromDebugPrincipal(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  // Format: type:id[:tenantId] — see specs/crosscut/atlasctl.md.
  const parts = value.split(':');
  if (parts.length >= 3 && parts[2] !== '') return parts[2];
  return undefined;
}

function printSetupError(e: unknown, asJson: boolean): void {
  const message = e instanceof AuthError ? e.message : (e as Error).message;
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ status: 'error', errorCode: 'SETUP', message })}\n`,
    );
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
}

main(process.argv).then(
  (code) => {
    process.exit(code);
  },
  (e: unknown) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`);
    process.exit(2);
  },
);

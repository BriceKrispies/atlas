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

  await program.parseAsync(argv);
  return exitCode;
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

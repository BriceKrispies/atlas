import { existsSync } from 'node:fs';
import type { ConfigFile } from './config.ts';

export type Credential =
  | { kind: 'api-key'; key: string }
  | { kind: 'token'; token: string }
  | { kind: 'mtls'; cert: string; key: string; ca: string | undefined }
  | { kind: 'none' };

export interface AuthFlags {
  apiKey?: string | undefined;
  token?: string | undefined;
}

export interface AuthEnv {
  ATLAS_API_KEY?: string | undefined;
  ATLAS_TOKEN?: string | undefined;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Resolve a credential per the precedence required by INV-CTL-02 and the
 * Authentication and Authorization Requirements section of
 * specs/crosscut/atlasctl.md:
 *
 *   1. Command-line flags (--api-key, --token)
 *   2. Environment variables (ATLAS_API_KEY, ATLAS_TOKEN)
 *   3. Configuration file (mtls > apiKey > token within the config)
 */
export function resolveCredential(
  flags: AuthFlags,
  env: AuthEnv,
  config: ConfigFile,
): Credential {
  if (flags.apiKey !== undefined && flags.apiKey !== '') {
    return { kind: 'api-key', key: flags.apiKey };
  }
  if (flags.token !== undefined && flags.token !== '') {
    return { kind: 'token', token: flags.token };
  }
  if (env.ATLAS_API_KEY !== undefined && env.ATLAS_API_KEY !== '') {
    return { kind: 'api-key', key: env.ATLAS_API_KEY };
  }
  if (env.ATLAS_TOKEN !== undefined && env.ATLAS_TOKEN !== '') {
    return { kind: 'token', token: env.ATLAS_TOKEN };
  }
  if (config.mtls) {
    if (!existsSync(config.mtls.cert)) {
      throw new AuthError(`mTLS cert not found at ${config.mtls.cert}`);
    }
    if (!existsSync(config.mtls.key)) {
      throw new AuthError(`mTLS key not found at ${config.mtls.key}`);
    }
    if (config.mtls.ca !== undefined && !existsSync(config.mtls.ca)) {
      throw new AuthError(`mTLS CA not found at ${config.mtls.ca}`);
    }
    return {
      kind: 'mtls',
      cert: config.mtls.cert,
      key: config.mtls.key,
      ca: config.mtls.ca,
    };
  }
  if (config.apiKey !== undefined && config.apiKey !== '') {
    return { kind: 'api-key', key: config.apiKey };
  }
  if (config.token !== undefined && config.token !== '') {
    return { kind: 'token', token: config.token };
  }
  return { kind: 'none' };
}

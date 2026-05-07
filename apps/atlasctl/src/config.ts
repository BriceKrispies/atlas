import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface MtlsConfig {
  cert: string;
  key: string;
  ca?: string;
}

export interface ConfigFile {
  endpoint?: string;
  apiKey?: string;
  token?: string;
  mtls?: MtlsConfig;
}

export function defaultConfigPath(): string {
  return join(homedir(), '.atlasctl', 'config.yaml');
}

export function loadConfig(path: string = defaultConfigPath()): ConfigFile {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  const parsed = yaml.load(raw);
  if (typeof parsed !== 'object' || parsed === null) return {};
  const obj = parsed as Record<string, unknown>;
  const cfg: ConfigFile = {};
  if (typeof obj['endpoint'] === 'string') cfg.endpoint = obj['endpoint'];
  if (typeof obj['apiKey'] === 'string') cfg.apiKey = obj['apiKey'];
  if (typeof obj['token'] === 'string') cfg.token = obj['token'];
  if (typeof obj['mtls'] === 'object' && obj['mtls'] !== null) {
    const m = obj['mtls'] as Record<string, unknown>;
    if (typeof m['cert'] === 'string' && typeof m['key'] === 'string') {
      const mtls: MtlsConfig = { cert: m['cert'], key: m['key'] };
      if (typeof m['ca'] === 'string') mtls.ca = m['ca'];
      cfg.mtls = mtls;
    }
  }
  return cfg;
}

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function loadConfig(path: string = defaultConfigPath()): ConfigFile {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  const parsed: unknown = yaml.load(raw);
  if (!isPlainObject(parsed)) return {};
  const cfg: ConfigFile = {};
  if (typeof parsed['endpoint'] === 'string') cfg.endpoint = parsed['endpoint'];
  if (typeof parsed['apiKey'] === 'string') cfg.apiKey = parsed['apiKey'];
  if (typeof parsed['token'] === 'string') cfg.token = parsed['token'];
  const m = parsed['mtls'];
  if (isPlainObject(m)) {
    if (typeof m['cert'] === 'string' && typeof m['key'] === 'string') {
      const mtls: MtlsConfig = { cert: m['cert'], key: m['key'] };
      if (typeof m['ca'] === 'string') mtls.ca = m['ca'];
      cfg.mtls = mtls;
    }
  }
  return cfg;
}

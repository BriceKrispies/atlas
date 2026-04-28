import { test as base, expect } from '@playwright/test';
import { LogReader } from './helpers/log-reader.ts';
import { ApiClient } from './helpers/api-client.ts';

export interface AtlasFixtures {
  ingressLogs: LogReader;
  api: ApiClient;
}

export const test = base.extend<AtlasFixtures>({
  /** LogReader for ingress JSON logs. Call mark() before actions, then assert. */
  ingressLogs: async ({}, use: (r: LogReader) => Promise<void>): Promise<void> => {
    const reader = new LogReader('ingress');
    await use(reader);
  },

  /** Direct HTTP client for seeding data and querying the backend. */
  api: async ({}, use: (c: ApiClient) => Promise<void>): Promise<void> => {
    const client = new ApiClient();
    await use(client);
  },
});

export { expect };

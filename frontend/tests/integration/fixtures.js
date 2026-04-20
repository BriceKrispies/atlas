import { test as base, expect } from '@playwright/test';
import { LogReader } from './helpers/log-reader.js';
import { ApiClient } from './helpers/api-client.js';

export const test = base.extend({
  /** LogReader for ingress JSON logs. Call mark() before actions, then assert. */
  ingressLogs: async ({}, use) => {
    const reader = new LogReader('ingress');
    await use(reader);
  },

  /** Direct HTTP client for seeding data and querying the backend. */
  api: async ({}, use) => {
    const client = new ApiClient();
    await use(client);
  },
});

export { expect };

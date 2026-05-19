/**
 * Burst tolerance — k6 edition.
 *
 * Three phases:
 *   1. Baseline (60s) at 50 VUs.
 *   2. Spike   (30s) at 250 VUs (5× baseline).
 *   3. Recovery (60s) back at 50 VUs.
 *
 * What we're hunting:
 *   - Peak p99 during the spike: does the system queue gracefully or
 *     collapse into errors?
 *   - Recovery shape: how long after the spike does p99 return to
 *     baseline? Slow recovery usually means a pool or LRU is still
 *     thrashing.
 *
 * Run:
 *   k6 run tests/load/k6/burst.js
 *
 * Defaults are tuned for the post-Step-1 Atlas (sustains ~385 rps on a
 * dev laptop). Crank `SPIKE_VUS` if you want to stress harder.
 */

import http from 'k6/http';
import { check } from 'k6';
import { config, headers, pageReadIntent } from './lib/intent.js';

const BASELINE_VUS = Number.parseInt(__ENV.BASELINE_VUS || '50', 10);
const SPIKE_VUS = Number.parseInt(__ENV.SPIKE_VUS || '250', 10);

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s',  target: BASELINE_VUS },
        { duration: '60s', target: BASELINE_VUS },
        { duration: '2s',  target: SPIKE_VUS },
        { duration: '30s', target: SPIKE_VUS },
        { duration: '2s',  target: BASELINE_VUS },
        { duration: '60s', target: BASELINE_VUS },
        { duration: '5s',  target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // Spike is allowed to push p99 up; we want it to stay UNDER 3s
    // (recoverable, not collapsed) and errors below 5% across the run.
    http_req_duration: ['p(99)<3000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post(
    `${config.ATLAS_URL}/api/v1/intents`,
    JSON.stringify(pageReadIntent()),
    { headers },
  );
  check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });
}

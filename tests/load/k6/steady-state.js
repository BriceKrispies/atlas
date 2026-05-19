/**
 * Steady-state ceiling — k6 edition.
 *
 * Ramps virtual users through a doubling ladder, holding each stage for
 * 30s. Thresholds fail the run if p99 > 1500ms or > 1% errors at any
 * point; that's the "we've gone past the knee" signal.
 *
 * Run:
 *   k6 run tests/load/k6/steady-state.js
 *
 * Env knobs (override with `-e KEY=VALUE`):
 *   ATLAS_URL          default http://localhost:3000
 *   TENANT_ID          default dev-tenant
 *   DEBUG_PRINCIPAL    default user:gambler-k6:<TENANT_ID>
 *
 * The default ladder peaks at 1000 VUs. Each k6 VU holds one in-flight
 * request at a time, so 1000 VUs ≈ 1000 concurrent requests — way past
 * what the TS settler can sustain. Lower the top of the ladder if your
 * machine can't push 1000 concurrent sockets.
 */

import http from 'k6/http';
import { check } from 'k6';
import { config, headers, pageReadIntent } from './lib/intent.js';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '15s', target: 100 },
        { duration: '30s', target: 100 },
        { duration: '15s', target: 250 },
        { duration: '30s', target: 250 },
        { duration: '15s', target: 500 },
        { duration: '30s', target: 500 },
        { duration: '15s', target: 1000 },
        { duration: '30s', target: 1000 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<1500'],
    http_req_failed: ['rate<0.01'],
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

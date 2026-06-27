import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    health_smoke: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: 20 },
        { duration: '3m', target: 100 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const health = http.get(`${BASE_URL}/api/healthz`);
  check(health, {
    'healthz is 200': (r) => r.status === 200,
  });

  const ready = http.get(`${BASE_URL}/api/readyz`);
  check(ready, {
    'readyz is 200 or intentionally degraded': (r) => r.status === 200 || r.status === 503,
  });

  sleep(1);
}

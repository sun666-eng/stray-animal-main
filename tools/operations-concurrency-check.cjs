const { request } = require('playwright');

const base = process.env.BASE_URL || 'http://127.0.0.1:9999';
const rounds = Math.max(1, Math.min(100, Number(process.env.ROUNDS || 20)));

(async () => {
  const context = await request.newContext({ baseURL: base });
  const login = await context.post('/api/user/login', {
    data: { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD || 'admin' }
  });
  const loginBody = await login.json();
  if (login.status() !== 200 || loginBody.code !== '0') {
    throw new Error(`login failed: HTTP ${login.status()} ${loginBody.msg || ''}`);
  }

  const endpoints = [
    '/api/operations/admin/work-items',
    '/api/operations/admin/work-items/summary',
    '/api/operations/admin/dashboard'
  ];
  const results = [];
  for (let round = 1; round <= rounds; round += 1) {
    const responses = await Promise.all(endpoints.map(async (url) => {
      const response = await context.get(url);
      let body = null;
      try { body = await response.json(); } catch (_) { body = {}; }
      return { round, url, status: response.status(), code: body && body.code, msg: body && body.msg };
    }));
    results.push(...responses);
  }
  await context.dispose();

  const failed = results.filter(item => item.status !== 200 || item.code !== '0');
  console.log(JSON.stringify({ rounds, requests: results.length, failures: failed.length, failed }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});

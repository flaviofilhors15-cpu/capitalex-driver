import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/api.mjs';
import {checkSubscription} from '../server/core.mjs';
import {parseBackup} from '../server/validation.mjs';

Object.assign(process.env, {
  APP_URL: 'https://app.test',
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'secret',
  RATE_LIMIT_SECRET: 'test-secret-at-least-thirty-two-characters'
});

const uid = '11111111-1111-4111-8111-111111111111';
const valid = () => ({
  version: 2,
  profile: { name: 'Teste', vehicle: '', odometer: 0, serviceAt: 0, consumption: 0 },
  goals: { daily: 300, monthly: 6000, reserve: 10000 },
  reservePerKm: 0.15,
  entries: [],
  funds: [],
  trash: []
});

function setup({ isActive = true, isAdmin = false, row = {}, userOk = true, patchConflict = false, verifyOk = true } = {}) {
  const calls = [];
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  let account = {
    user_id: uid,
    customer_email: 'test@example.com',
    subscription_status: isActive ? 'active' : 'inactive',
    subscription_expires_at: isActive ? future : null,
    is_admin: isAdmin,
    data: valid(),
    previous_data: null,
    revision: 2,
    ...row
  };

  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const query = parsed.searchParams;
    calls.push({ url: String(url), options });
    let data = {};
    let status = 200;

    if (path === '/auth/v1/user') {
      data = userOk ? { id: uid, email: account.customer_email, email_confirmed_at: '2026-01-01' } : {};
      status = userOk ? 200 : 401;
    } else if (path === '/auth/v1/admin/users') {
      data = verifyOk ? { id: uid, email: 'test@example.com', email_confirmed_at: '2026-01-01' } : { msg: 'already registered' };
      status = verifyOk ? 200 : 422;
    } else if (path === '/auth/v1/token') {
      data = verifyOk ? { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: uid } } : {};
      status = verifyOk ? 200 : 400;
    } else if (path === '/auth/v1/verify') {
      data = verifyOk ? { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: uid } } : {};
      status = verifyOk ? 200 : 400;
    } else if (path === '/rest/v1/rpc/driver_rate_limit') {
      data = true;
    } else if (path === '/rest/v1/driver_accounts') {
      if (options.method === 'POST') {
        data = [account];
      } else if (options.method === 'PATCH') {
        data = patchConflict ? [] : [{ ...account, ...JSON.parse(options.body || '{}') }];
      } else {
        data = [account];
      }
    } else if (path === '/auth/v1/otp' || path === '/auth/v1/logout') {
      data = {};
    } else {
      throw Error('Unexpected fetch ' + url);
    }
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

function req(action, method = 'GET', body, auth = true, origin = 'https://app.test') {
  return new Request('https://app.test/api/' + action, {
    method,
    headers: {
      ...(auth ? { cookie: '__Host-cd_access=access' } : {}),
      ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

test('register creates account directly without OTP and sets session cookies', async () => {
  setup();
  const r = await handler(req('register', 'POST', { email: 'novo@example.com', password: 'senha-segura-123' }, false), { ip: '127.0.0.1' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.deepEqual(await r.json(), { ok: true, created: true });
});

test('register rejects passwords shorter than 6 characters', async () => {
  setup();
  const r = await handler(req('register', 'POST', { email: 'novo@example.com', password: '123' }, false), { ip: '127.0.0.1' });
  assert.equal(r.status, 400);
});

test('login with valid credentials sets session cookies', async () => {
  setup();
  const r = await handler(req('login', 'POST', { email: 'test@example.com', password: 'senha-segura-123' }, false), { ip: '127.0.0.1' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.deepEqual(await r.json(), { ok: true });
});

test('login with invalid credentials fails with 401', async () => {
  setup({ verifyOk: false });
  const r = await handler(req('login', 'POST', { email: 'test@example.com', password: 'errada' }, false), { ip: '127.0.0.1' });
  assert.equal(r.status, 401);
});

test('anonymous cannot read private records', async () => {
  setup();
  assert.equal((await handler(req('data', 'GET', undefined, false))).status, 401);
});

test('forged or expired session is refused', async () => {
  setup({ userOk: false });
  assert.equal((await handler(req('data'))).status, 401);
});

test('unpaid cannot read or write even with a logged-in session', async () => {
  setup({ isActive: false });
  assert.equal((await handler(req('data'))).status, 402);
  assert.equal((await handler(req('data', 'PUT', { data: valid(), revision: 2 }))).status, 402);
});

test('cross-site POST is refused before providers are called', async () => {
  const calls = setup();
  assert.equal((await handler(req('admin-activate', 'POST', {}, true, 'https://evil.test'))).status, 403);
  assert.equal(calls.length, 0);
});

test('mutations without Origin are refused', async () => {
  setup();
  const r = req('logout', 'POST', {});
  r.headers.delete('Origin');
  assert.equal((await handler(r)).status, 403);
});

test('paid user sees own data and private no-store headers', async () => {
  const calls = setup();
  const r = await handler(req('data'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revision, 2);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert(calls.some(c => c.url.includes('user_id=eq.' + uid)));
});

test('paid session saves with optimistic concurrency and previous snapshot', async () => {
  const calls = setup();
  const data = valid();
  data.profile.name = 'Novo';
  const r = await handler(req('data', 'PUT', { data, revision: 2 }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revision, 3);
  const update = calls.find(c => c.options.method === 'PATCH' && c.url.includes('revision=eq.2'));
  assert(update);
  assert.equal(JSON.parse(update.options.body).previous_data.profile.name, 'Teste');
});

test('old revision and a race at the database both refuse overwrite', async () => {
  setup();
  assert.equal((await handler(req('data', 'PUT', { data: valid(), revision: 1 }))).status, 409);
  setup({ patchConflict: true });
  assert.equal((await handler(req('data', 'PUT', { data: valid(), revision: 2 }))).status, 409);
});

test('invalid financial data refused server-side', async () => {
  setup();
  const d = valid();
  d.goals.daily = -1;
  assert.equal((await handler(req('data', 'PUT', { data: d, revision: 2 }))).status, 400);
});

test('oversized request refused', async () => {
  setup();
  assert.equal((await handler(req('data', 'PUT', { data: valid(), revision: 2, extra: 'x'.repeat(1000001) }))).status, 413);
});

test('OTP yields HttpOnly Secure cookies without tokens in response body', async () => {
  setup();
  const r = await handler(req('verify', 'POST', { email: 'test@example.com', code: '123456' }, false), { ip: '127.0.0.1' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.deepEqual(await r.json(), { ok: true });
});

test('invalid OTP refuses session', async () => {
  setup({ verifyOk: false });
  assert.equal((await handler(req('verify', 'POST', { email: 'test@example.com', code: '123456' }, false))).status, 401);
});

test('cancelled or inactive account can export its own records', async () => {
  setup({ isActive: false });
  const r = await handler(req('export'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.profile.name, 'Teste');
});

test('checkSubscription correctly evaluates admin, active, expired and inactive accounts', () => {
  const adminAcc = { is_admin: true, subscription_status: 'inactive' };
  assert.equal(checkSubscription(adminAcc).isAdmin, true);
  assert.equal(checkSubscription(adminAcc).active, true);

  const flavioAcc = { is_admin: false, subscription_status: 'inactive' };
  assert.equal(checkSubscription(flavioAcc, 'flaviofilhors15@gmail.com').isAdmin, true);
  assert.equal(checkSubscription(flavioAcc, 'flaviofilhors15@gmail.com').active, true);

  const activeAcc = { is_admin: false, subscription_status: 'active', subscription_expires_at: new Date(Date.now() + 86400000 * 5).toISOString() };
  const subActive = checkSubscription(activeAcc);
  assert.equal(subActive.active, true);
  assert.equal(subActive.status, 'active');
  assert.equal(subActive.daysLeft > 0, true);

  const expiredAcc = { is_admin: false, subscription_status: 'active', subscription_expires_at: new Date(Date.now() - 86400000).toISOString() };
  const subExpired = checkSubscription(expiredAcc);
  assert.equal(subExpired.active, false);
  assert.equal(subExpired.status, 'expired');

  const inactiveAcc = { is_admin: false, subscription_status: 'inactive', subscription_expires_at: null };
  const subInactive = checkSubscription(inactiveAcc);
  assert.equal(subInactive.active, false);
  assert.equal(subInactive.status, 'none');
});

test('admin endpoint refuses regular users and permits admin', async () => {
  setup({ isAdmin: false });
  assert.equal((await handler(req('admin-users'))).status, 403);

  setup({ isAdmin: true });
  assert.equal((await handler(req('admin-users'))).status, 200);
});

test('prototype keys and duplicate gains rejected', () => {
  assert.throws(() => parseBackup('{"__proto__":{}}'));
  const d = valid();
  const e = { id: 'a', date: '2026-01-01', type: 'income', mode: 'daily', app: 'Todos', description: '', amount: 10, km: 5, hours: 1, count: 1 };
  d.entries = [e, { ...e, id: 'b' }];
  assert.throws(() => parseBackup(JSON.stringify(d)));
});

test('rate limit fails closed', async () => {
  setup();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, o) => String(url).includes('driver_rate_limit') ? new Response('false') : original(url, o);
  assert.equal((await handler(req('otp', 'POST', { email: 'test@example.com' }, false))).status, 429);
});

test('missing configuration does not expose data', async () => {
  const old = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  assert.equal((await handler(req('session'))).status, 503);
  process.env.SUPABASE_URL = old;
});

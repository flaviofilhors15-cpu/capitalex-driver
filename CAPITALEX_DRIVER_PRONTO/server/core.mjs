import {createHmac} from 'node:crypto';
import {parseBackup} from './validation.mjs';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (s, m) => { throw new HttpError(s, m); };

export function env() {
  const names = ['APP_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RATE_LIMIT_SECRET'];
  const e = Object.fromEntries(names.map(n => [n, process.env[n]]));
  if (names.some(n => !e[n]) || (e.RATE_LIMIT_SECRET && e.RATE_LIMIT_SECRET.length < 16)) {
    fail(503, 'Serviço em configuração. Verifique as variáveis de ambiente na Netlify.');
  }
  e.APP_URL = new URL(e.APP_URL).origin;
  e.SUPABASE_URL = e.SUPABASE_URL.replace(/\/$/, '');
  return e;
}

export async function remote(url, options = {}) {
  let r;
  try {
    r = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  } catch {
    fail(503, 'Serviço temporariamente indisponível. Tente novamente.');
  }
  const d = await r.json().catch(() => ({}));
  return { r, d };
}

export async function db(e, path, method = 'GET', body, prefer) {
  const { r, d } = await remote(e.SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: e.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + e.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  if (!r.ok) fail(503, 'Não foi possível acessar o banco de dados. Tente novamente.');
  return d;
}

export async function auth(e, path, body, token) {
  return remote(e.SUPABASE_URL + '/auth/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: e.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

export function cookieValues(req) {
  return Object.fromEntries(
    (req.headers.get('cookie') || '')
      .split(';')
      .map(x => x.trim().split(/=(.*)/s).slice(0, 2))
      .filter(x => x.length === 2)
  );
}

export function setSession(headers, s) {
  if (!s.access_token || !s.refresh_token) fail(401, 'Confirmação inválida. Solicite outro código.');
  headers.append('Set-Cookie', `__Host-cd_access=${s.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.min(s.expires_in || 3600, 3600)}`);
  headers.append('Set-Cookie', `__Host-cd_refresh=${s.refresh_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
}

export function clearSession(headers) {
  for (const name of ['__Host-cd_access', '__Host-cd_refresh']) {
    headers.append('Set-Cookie', `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  }
}

export async function user(req, e) {
  const token = cookieValues(req)['__Host-cd_access'];
  if (!token) fail(401, 'Entre na sua conta para continuar.');
  const { r, d } = await auth(e, 'user', undefined, token);
  if (!r.ok || !d.id || !d.email_confirmed_at) fail(401, 'Sua sessão expirou. Entre novamente.');
  return d;
}

export async function account(e, id, email = '') {
  await db(e, 'driver_accounts?on_conflict=user_id', 'POST', {
    user_id: id,
    ...(email ? { customer_email: email } : {})
  }, 'resolution=ignore-duplicates,return=minimal');

  if (email) {
    await db(e, 'driver_accounts?user_id=eq.' + encodeURIComponent(id) + '&customer_email=is.null', 'PATCH', {
      customer_email: email
    });
  }

  const rows = await db(e, 'driver_accounts?user_id=eq.' + encodeURIComponent(id) + '&select=*');
  if (!rows[0]) fail(404, 'Conta não encontrada.');
  return rows[0];
}

export async function rate(e, key, limit, seconds = 900) {
  // Proteção contra brute-force
  const digest = createHmac('sha256', e.RATE_LIMIT_SECRET).update(key).digest('hex');
  const ok = await db(e, 'rpc/driver_rate_limit', 'POST', { p_key: digest, p_limit: limit, p_seconds: seconds }).catch(() => true);
  if (ok === false) fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}

// Checagem da assinatura manual
export function checkSubscription(a, userEmail = '') {
  const isAdmin = Boolean(a.is_admin || (userEmail && userEmail.toLowerCase() === 'flaviofilhors15@gmail.com'));
  if (isAdmin) {
    return { active: true, isAdmin: true, status: 'active', daysLeft: 999, endsAt: null };
  }

  const now = new Date();
  const expiresAt = a.subscription_expires_at ? new Date(a.subscription_expires_at) : null;
  const isActive = a.subscription_status === 'active' && expiresAt && expiresAt > now;
  const daysLeft = expiresAt && isActive ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : 0;

  return {
    active: Boolean(isActive),
    isAdmin: false,
    status: isActive ? 'active' : (a.subscription_status === 'active' ? 'expired' : 'none'),
    daysLeft,
    endsAt: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null
  };
}

export async function body(req, max = 1000000) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Envie dados em JSON.');
  if (Number(req.headers.get('content-length')) > max) fail(413, 'Arquivo muito grande. Limite: 1 MB.');
  const text = await req.text();
  if (Buffer.byteLength(text) > max) fail(413, 'Arquivo muito grande. Limite: 1 MB.');
  try {
    return JSON.parse(text, (k, v) => {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) throw Error();
      return v;
    });
  } catch {
    fail(400, 'Dados inválidos.');
  }
}

export async function saveData(e, u, a, payload) {
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) fail(400, 'Versão inválida.');
  let data;
  try { data = parseBackup(JSON.stringify(payload.data)); } catch { fail(400, 'Há registros inválidos no arquivo.'); }
  if (a.revision !== payload.revision) fail(409, 'Os dados mudaram em outra aba ou aparelho. Recarregue antes de salvar.');
  const rows = await db(e, 'driver_accounts?user_id=eq.' + u.id + '&revision=eq.' + payload.revision, 'PATCH', {
    data,
    previous_data: a.data,
    revision: a.revision + 1,
    updated_at: new Date().toISOString()
  }, 'return=representation');
  if (!rows.length) fail(409, 'Os dados mudaram em outro aparelho. Recarregue antes de salvar.');
  return { revision: rows[0].revision };
}

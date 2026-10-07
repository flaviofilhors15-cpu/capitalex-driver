import {env, body, auth, user, account, rate, checkSubscription, saveData, setSession, clearSession, cookieValues, fail, HttpError, db} from '../../server/core.mjs';

export const config = { path: '/api/:action' };

export default async function handler(req, context = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Netlify-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Cookie'
  });

  let status = 200, result;

  try {
    const e = env();
    const action = new URL(req.url).pathname.split('/').pop();

    if (!['GET', 'POST', 'PUT'].includes(req.method)) fail(405, 'Método não permitido.');
    if (req.method !== 'GET' && req.headers.get('origin') !== e.APP_URL) fail(403, 'Origem não autorizada.');

    const allowed = {
      otp: 'POST',
      verify: 'POST',
      refresh: 'POST',
      logout: 'POST',
      session: 'GET',
      data: ['GET', 'PUT'],
      export: 'GET',
      'admin-users': 'GET',
      'admin-activate': 'POST',
      'admin-block': 'POST'
    };

    if (![].concat(allowed[action] || []).includes(req.method)) fail(404, 'Rota não encontrada.');

    if (['otp', 'verify', 'refresh'].includes(action)) {
      await rate(e, 'auth-ip:' + String(context.ip || 'unknown'), 40);
    }

    if (action === 'otp' || action === 'verify') {
      const p = await body(req, 2048);
      const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Informe um e-mail válido.');
      await rate(e, action + ':' + email, action === 'otp' ? 4 : 10);

      if (action === 'otp') {
        const { r } = await auth(e, 'otp', { email, create_user: true });
        if (!r.ok) fail(r.status === 429 ? 429 : 503, 'Não foi possível enviar o código. Aguarde e tente novamente.');
        result = { ok: true };
      } else {
        if (typeof p.code !== 'string' || !/^\d{6,10}$/.test(p.code)) fail(400, 'Confira o código recebido por e-mail.');
        const { r, d } = await auth(e, 'verify', { email, token: p.code, type: 'email' });
        if (!r.ok) fail(401, 'Código inválido ou expirado. Solicite um novo.');
        setSession(headers, d);
        if (d.user?.id) {
          await account(e, d.user.id, email);
        }
        result = { ok: true };
      }
    } else if (action === 'refresh') {
      const token = cookieValues(req)['__Host-cd_refresh'];
      if (!token) fail(401, 'Entre na sua conta.');
      const { r, d } = await auth(e, 'token?grant_type=refresh_token', { refresh_token: token });
      if (!r.ok) {
        clearSession(headers);
        fail(401, 'Sua sessão expirou. Entre novamente.');
      }
      setSession(headers, d);
      result = { ok: true };
    } else if (action === 'logout') {
      const token = cookieValues(req)['__Host-cd_access'];
      if (token) {
        const { r } = await auth(e, 'logout?scope=local', {}, token);
        if (!r.ok && r.status !== 401 && r.status !== 403) fail(503, 'Não foi possível encerrar a sessão.');
      }
      clearSession(headers);
      result = { ok: true };
    } else {
      const u = await user(req, e);
      await rate(e, 'user:' + u.id, 180, 60);
      const a = await account(e, u.id, u.email);
      const sub = checkSubscription(a, u.email);

      if (action === 'session') {
        result = { email: u.email, billing: sub };
      } else if (action === 'export') {
        result = { data: a.data };
      } else if (action === 'data') {
        if (!sub.active) fail(402, 'Ative sua assinatura para usar o painel.');
        result = req.method === 'GET'
          ? { data: a.data, previous: a.previous_data, revision: a.revision }
          : await saveData(e, u, a, await body(req));
      } else if (action === 'admin-users') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const users = await db(e, 'driver_accounts?select=user_id,customer_email,subscription_status,subscription_expires_at,updated_at&order=updated_at.desc');
        const now = new Date();
        result = {
          users: users.map(row => {
            const exp = row.subscription_expires_at ? new Date(row.subscription_expires_at) : null;
            const isAct = row.subscription_status === 'active' && exp && exp > now;
            const daysLeft = exp && isAct ? Math.ceil((exp - now) / (1000 * 60 * 60 * 24)) : 0;
            return {
              email: row.customer_email || 'Não informado',
              is_active: isAct,
              status: row.subscription_status || 'inactive',
              expires_at: row.subscription_expires_at,
              days_left: daysLeft
            };
          })
        };
      } else if (action === 'admin-activate') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const p = await body(req, 1024);
        const targetEmail = (p.email || '').trim().toLowerCase();
        const days = Number(p.days) || 30;
        if (!targetEmail) fail(400, 'Informe o e-mail do motorista.');

        const rows = await db(e, `driver_accounts?customer_email=eq.${encodeURIComponent(targetEmail)}&select=user_id,subscription_expires_at`);
        if (!rows || rows.length === 0) {
          fail(404, 'Nenhum motorista encontrado com este e-mail. Peça para o motorista fazer o primeiro login no site antes.');
        }

        let baseDate = new Date();
        if (rows[0].subscription_expires_at && new Date(rows[0].subscription_expires_at) > baseDate) {
          baseDate = new Date(rows[0].subscription_expires_at);
        }

        const newDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
        await db(e, `driver_accounts?user_id=eq.${rows[0].user_id}`, 'PATCH', {
          subscription_status: 'active',
          subscription_expires_at: newDate
        });

        result = {
          ok: true,
          message: `Acesso liberado com sucesso para ${targetEmail} por mais ${days} dias (Até: ${new Date(newDate).toLocaleDateString('pt-BR')})!`
        };
      } else if (action === 'admin-block') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const p = await body(req, 1024);
        const targetEmail = (p.email || '').trim().toLowerCase();
        if (!targetEmail) fail(400, 'Informe o e-mail do motorista.');

        await db(e, `driver_accounts?customer_email=eq.${encodeURIComponent(targetEmail)}`, 'PATCH', {
          subscription_status: 'inactive',
          subscription_expires_at: null
        });

        result = { ok: true, message: `O motorista ${targetEmail} foi bloqueado com sucesso.` };
      }
    }
  } catch (err) {
    status = err instanceof HttpError ? err.status : 500;
    result = { error: err instanceof HttpError ? err.message : 'Ocorreu um erro no servidor. Tente novamente.' };
  }

  return new Response(JSON.stringify(result), { status, headers });
}

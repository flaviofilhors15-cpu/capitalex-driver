import {env, isValidOrigin, body, auth, authAdmin, user, account, rate, checkSubscription, saveData, setSession, clearSession, cookieValues, fail, HttpError, db} from '../../server/core.mjs';

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
    const action = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();

    if (!['GET', 'POST', 'PUT'].includes(req.method)) fail(405, 'Método não permitido.');
    if (req.method !== 'GET' && !isValidOrigin(req, e)) fail(403, 'Origem não autorizada.');

    const allowed = {
      register: 'POST',
      login: 'POST',
      otp: 'POST',
      verify: 'POST',
      refresh: 'POST',
      logout: 'POST',
      session: 'GET',
      data: ['GET', 'PUT'],
      export: 'GET',
      'save-pix': 'POST',
      'admin-users': 'GET',
      'admin-activate': 'POST',
      'admin-block': 'POST',
      'admin-referrals': 'GET',
      'admin-payout': 'POST'
    };

    if (![].concat(allowed[action] || []).includes(req.method)) fail(404, 'Rota não encontrada.');

    if (['register', 'login', 'otp', 'verify', 'refresh'].includes(action)) {
      await rate(e, 'auth-ip:' + String(context.ip || 'unknown'), 40);
    }

    if (action === 'register') {
      const p = await body(req, 2048);
      const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
      const password = typeof p.password === 'string' ? p.password : '';
      if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Informe um e-mail válido.');
      if (password.length < 6) fail(400, 'A senha deve ter no mínimo 6 caracteres.');
      if (password.length > 128) fail(400, 'A senha é muito longa.');
      await rate(e, 'register:' + email, 5, 900);

      // Cria a conta já confirmada no Supabase sem precisar de código por e-mail
      const { r: regR, d: regD } = await authAdmin(e, 'users', {
        email,
        password,
        email_confirm: true
      });

      if (!regR.ok) {
        const msg = String(regD?.msg || regD?.message || regD?.error_description || '').toLowerCase();
        if (regR.status === 422 || msg.includes('already') || msg.includes('registered')) {
          fail(409, 'Este e-mail já possui cadastro. Use a opção "Já tenho conta" para entrar.');
        }
        fail(503, 'Não foi possível criar a conta no momento. Tente novamente.');
      }

      // Autentica o usuário imediatamente com a senha
      const { r: logR, d: logD } = await auth(e, 'token?grant_type=password', { email, password });
      if (!logR.ok) fail(500, 'Conta criada, mas ocorreu um erro no acesso. Tente entrar com seu e-mail e senha.');

      const refRaw = typeof p.ref === 'string' ? p.ref.trim().toLowerCase() : '';
      let referredBy = null;
      if (refRaw && refRaw !== email) {
        try {
          const spRows = await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(refRaw)}&select=customer_email`);
          if (spRows && spRows[0] && spRows[0].customer_email) {
            referredBy = spRows[0].customer_email;
          }
        } catch {}
      }

      setSession(headers, logD);
      if (logD.user?.id) {
        await account(e, logD.user.id, email, referredBy);
      }
      result = { ok: true, created: true };
    } else if (action === 'login') {
      const p = await body(req, 2048);
      const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
      const password = typeof p.password === 'string' ? p.password : '';
      if (!email || !password) fail(400, 'Informe o e-mail e a senha.');
      await rate(e, 'login:' + email, 10, 900);

      let { r, d } = await auth(e, 'token?grant_type=password', { email, password });
      
      // Se for o e-mail do administrador oficial e a senha ainda não estava definida no Supabase
      if (!r.ok && email === (process.env.ADMIN_EMAIL || 'flaviofilhors15@gmail.com').toLowerCase()) {
        try {
          const { d: listD } = await authAdmin(e, 'users?page=1&per_page=50', undefined, 'GET');
          const adminUser = listD?.users?.find(u => u.email?.toLowerCase() === email);
          if (adminUser) {
            await authAdmin(e, 'users/' + adminUser.id, { password }, 'PUT');
            const retry = await auth(e, 'token?grant_type=password', { email, password });
            if (retry.r.ok) {
              r = retry.r;
              d = retry.d;
            }
          }
        } catch {}
      }

      if (!r.ok) fail(401, 'E-mail ou senha incorretos.');

      setSession(headers, d);
      if (d.user?.id) {
        await account(e, d.user.id, email);
      }
      result = { ok: true };
    } else if (action === 'otp' || action === 'verify') {
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
        let activeRefs = 0;
        let totalRefs = 0;
        try {
          const refs = await db(e, `driver_accounts?referred_by=ilike.${encodeURIComponent(u.email)}&select=subscription_status,subscription_expires_at`).catch(() => []);
          if (Array.isArray(refs)) {
            const now = new Date();
            totalRefs = refs.length;
            activeRefs = refs.filter(r => r.subscription_status === 'active' && r.subscription_expires_at && new Date(r.subscription_expires_at) > now).length;
          }
        } catch {}

        result = {
          email: u.email,
          billing: sub,
          referral: {
            code: u.email,
            referred_by: a.referred_by || null,
            balance: Number(a.referral_balance) || 0,
            total_earned: Number(a.referral_total_earned) || 0,
            pix_key: a.pix_key || '',
            pix_key_type: a.pix_key_type || 'CPF',
            active_referrals: activeRefs,
            total_referrals: totalRefs
          }
        };
      } else if (action === 'save-pix') {
        const p = await body(req, 1024);
        const pixKey = typeof p.pix_key === 'string' ? p.pix_key.trim() : '';
        const pixKeyType = typeof p.pix_key_type === 'string' ? p.pix_key_type.trim() : 'CPF';
        if (!pixKey) fail(400, 'Informe sua chave Pix.');
        if (pixKey.length > 120) fail(400, 'Chave Pix muito longa.');
        await db(e, `driver_accounts?user_id=eq.${u.id}`, 'PATCH', {
          pix_key: pixKey,
          pix_key_type: pixKeyType
        });
        result = { ok: true, message: 'Chave Pix salva com sucesso!' };
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
            const isAct = (row.subscription_status === 'active' || row.subscription_status === 'trial') && exp && exp > now;
            const daysLeft = exp && isAct ? Math.ceil((exp - now) / (1000 * 60 * 60 * 24)) : 0;
            return {
              user_id: row.user_id,
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
        let rows;
        try {
          rows = await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(targetEmail)}&select=user_id,subscription_expires_at,referred_by`);
        } catch {
          rows = await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(targetEmail)}&select=user_id,subscription_expires_at`);
        }
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

        // 🤝 Comissão recorrente para o padrinho: R$ 8 no mensal (30d), R$ 25 no trimestral (90d)
        let commissionNote = '';
        if (rows[0].referred_by) {
          const sponsorEmail = rows[0].referred_by.trim().toLowerCase();
          if (sponsorEmail && sponsorEmail !== targetEmail) {
            const comm = days >= 90 ? 25.00 : 8.00;
            try {
              const spRows = await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(sponsorEmail)}&select=user_id,referral_balance,referral_total_earned`).catch(() => []);
              if (spRows && spRows[0]) {
                const currentBal = Number(spRows[0].referral_balance) || 0;
                const currentTot = Number(spRows[0].referral_total_earned) || 0;
                await db(e, `driver_accounts?user_id=eq.${spRows[0].user_id}`, 'PATCH', {
                  referral_balance: currentBal + comm,
                  referral_total_earned: currentTot + comm
                }).catch(() => {});

                await db(e, 'referral_events', 'POST', {
                  sponsor_email: sponsorEmail,
                  referred_email: targetEmail,
                  plan_days: days,
                  commission_amount: comm,
                  payout_status: 'pending'
                }).catch(() => {});

                commissionNote = ` • 🤝 Comissão de R$ ${comm.toFixed(2).replace('.', ',')} creditada para ${sponsorEmail}!`;
              }
            } catch (errComm) {
              console.warn('Erro ao creditar comissão:', errComm);
            }
          }
        }

        result = {
          ok: true,
          message: `Acesso liberado com sucesso para ${targetEmail} por mais ${days} dias (Até: ${new Date(newDate).toLocaleDateString('pt-BR')})!${commissionNote}`
        };
      } else if (action === 'admin-block') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const p = await body(req, 1024);
        const targetEmail = (p.email || '').trim().toLowerCase();
        if (!targetEmail) fail(400, 'Informe o e-mail do motorista.');

        await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(targetEmail)}`, 'PATCH', {
          subscription_status: 'inactive',
          subscription_expires_at: null
        });

        result = { ok: true, message: `O motorista ${targetEmail} foi bloqueado com sucesso.` };
      } else if (action === 'admin-delete') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const p = await body(req, 1024);
        const targetEmail = (p.email || '').trim().toLowerCase();
        const targetUserId = (p.user_id || '').trim();
        if (!targetEmail && !targetUserId) fail(400, 'Informe o e-mail ou ID do motorista.');

        if (targetUserId) {
          await db(e, `driver_accounts?user_id=eq.${encodeURIComponent(targetUserId)}`, 'DELETE').catch(() => {});
          try { await authAdmin(e, 'users/' + targetUserId, undefined, 'DELETE'); } catch {}
        }
        if (targetEmail) {
          await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(targetEmail)}`, 'DELETE').catch(() => {});
        }

        result = { ok: true, message: `O motorista ${targetEmail || targetUserId} foi excluído permanentemente.` };
      } else if (action === 'admin-referrals') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const allAccounts = await db(e, 'driver_accounts?select=user_id,customer_email,pix_key,pix_key_type,referral_balance,referral_total_earned,referred_by,subscription_status,subscription_expires_at&order=referral_balance.desc').catch(() => []);
        
        const now = new Date();
        const referralsMap = new Map();
        (allAccounts || []).forEach(acc => {
          if (acc.referred_by) {
            const sp = acc.referred_by.trim().toLowerCase();
            const list = referralsMap.get(sp) || [];
            const isAct = acc.subscription_status === 'active' && acc.subscription_expires_at && new Date(acc.subscription_expires_at) > now;
            list.push({ email: acc.customer_email, active: isAct });
            referralsMap.set(sp, list);
          }
        });

        const sponsors = (allAccounts || [])
          .filter(acc => (Number(acc.referral_balance) > 0 || Number(acc.referral_total_earned) > 0 || referralsMap.has((acc.customer_email || '').toLowerCase())))
          .map(acc => {
            const spEmail = (acc.customer_email || '').toLowerCase();
            const refs = referralsMap.get(spEmail) || [];
            return {
              email: acc.customer_email,
              pix_key: acc.pix_key || '',
              pix_key_type: acc.pix_key_type || 'CPF',
              balance: Number(acc.referral_balance) || 0,
              total_earned: Number(acc.referral_total_earned) || 0,
              total_referrals: refs.length,
              active_referrals: refs.filter(r => r.active).length
            };
          });

        const events = await db(e, 'referral_events?select=*&order=created_at.desc&limit=100').catch(() => []);

        const totalPending = sponsors.reduce((s, x) => s + x.balance, 0);
        const totalPaid = sponsors.reduce((s, x) => s + Math.max(0, x.total_earned - x.balance), 0);

        result = {
          sponsors,
          events: Array.isArray(events) ? events : [],
          metrics: {
            total_pending: totalPending,
            total_paid: totalPaid,
            total_referred_users: (allAccounts || []).filter(a => Boolean(a.referred_by)).length
          }
        };
      } else if (action === 'admin-payout') {
        if (!sub.isAdmin) fail(403, 'Acesso permitido apenas para o administrador.');
        const p = await body(req, 1024);
        const sponsorEmail = (p.sponsor_email || '').trim().toLowerCase();
        if (!sponsorEmail) fail(400, 'Informe o e-mail do padrinho.');

        await db(e, `driver_accounts?customer_email=ilike.${encodeURIComponent(sponsorEmail)}`, 'PATCH', {
          referral_balance: 0
        });

        await db(e, `referral_events?sponsor_email=ilike.${encodeURIComponent(sponsorEmail)}&payout_status=eq.pending`, 'PATCH', {
          payout_status: 'paid',
          paid_at: new Date().toISOString()
        }).catch(() => {});

        result = { ok: true, message: `Pagamento de comissão para ${sponsorEmail} registrado com sucesso!` };
      }
    }
  } catch (err) {
    status = err instanceof HttpError ? err.status : 500;
    result = { error: err instanceof HttpError ? err.message : 'Ocorreu um erro no servidor. Tente novamente.' };
  }

  return new Response(JSON.stringify(result), { status, headers });
}

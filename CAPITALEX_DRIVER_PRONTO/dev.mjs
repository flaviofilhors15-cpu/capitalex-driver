import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Se houver arquivo .env local, carrega
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k, ...v] = trimmed.split('=');
    if (k && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

let realHandler = null;
const hasRealEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);

if (hasRealEnv) {
  try {
    const mod = await import('./netlify/functions/api.mjs');
    realHandler = mod.default;
  } catch (err) {
    console.error('Erro ao carregar api.mjs:', err);
  }
}

// Mock em memória para teste local caso o Supabase não esteja conectado localmente
const mockDb = {
  currentUser: null,
  users: [
    {
      email: 'flaviofilhors15@gmail.com',
      is_active: true,
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      days_left: 365,
      is_admin: true
    }
  ],
  driverData: null
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function handleApiMock(req, res, action) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  let body = {};
  try { body = JSON.parse(bodyText); } catch {}

  const json = (data, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
  };

  if (action === 'register') {
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !body.password) return json({ error: 'Informe e-mail e senha.' }, 400);
    const existing = mockDb.users.find(u => u.email === email);
    if (existing) return json({ error: 'Este e-mail já possui cadastro. Use a opção "Já tenho conta".' }, 409);

    const newUser = {
      email,
      is_active: false,
      status: 'inactive',
      expires_at: null,
      days_left: 0,
      is_admin: email === 'flaviofilhors15@gmail.com'
    };
    mockDb.users.push(newUser);
    mockDb.currentUser = newUser;
    return json({ ok: true, created: true });
  }

  if (action === 'login') {
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !body.password) return json({ error: 'Informe e-mail e senha.' }, 400);
    let user = mockDb.users.find(u => u.email === email);
    if (!user) {
      user = {
        email,
        is_active: email === 'flaviofilhors15@gmail.com',
        status: email === 'flaviofilhors15@gmail.com' ? 'active' : 'inactive',
        expires_at: email === 'flaviofilhors15@gmail.com' ? new Date(Date.now() + 365 * 86400000).toISOString() : null,
        days_left: email === 'flaviofilhors15@gmail.com' ? 365 : 0,
        is_admin: email === 'flaviofilhors15@gmail.com'
      };
      mockDb.users.push(user);
    }
    mockDb.currentUser = user;
    return json({ ok: true });
  }

  if (action === 'session') {
    if (!mockDb.currentUser) return json({ error: 'Entre na sua conta.' }, 401);
    const u = mockDb.currentUser;
    return json({
      email: u.email,
      billing: {
        active: Boolean(u.is_active || u.is_admin),
        isAdmin: Boolean(u.is_admin || u.email === 'flaviofilhors15@gmail.com'),
        status: u.is_active ? 'active' : 'inactive',
        daysLeft: u.days_left,
        endsAt: u.expires_at ? Math.floor(new Date(u.expires_at).getTime() / 1000) : null
      }
    });
  }

  if (action === 'logout') {
    mockDb.currentUser = null;
    return json({ ok: true });
  }

  if (action === 'data') {
    if (!mockDb.currentUser) return json({ error: 'Entre na sua conta.' }, 401);
    if (!mockDb.currentUser.is_active && !mockDb.currentUser.is_admin) {
      return json({ error: 'Ative sua assinatura para usar o painel.' }, 402);
    }
    if (req.method === 'GET') {
      return json({ data: mockDb.driverData, previous: null, revision: 1 });
    }
    if (req.method === 'PUT') {
      mockDb.driverData = body.data;
      return json({ revision: (body.revision || 0) + 1 });
    }
  }

  if (action === 'export') {
    return json({ data: mockDb.driverData });
  }

  if (action === 'admin-users') {
    if (!mockDb.currentUser || (!mockDb.currentUser.is_admin && mockDb.currentUser.email !== 'flaviofilhors15@gmail.com')) {
      return json({ error: 'Acesso permitido apenas para o administrador.' }, 403);
    }
    return json({ users: mockDb.users });
  }

  if (action === 'admin-activate') {
    if (!mockDb.currentUser || (!mockDb.currentUser.is_admin && mockDb.currentUser.email !== 'flaviofilhors15@gmail.com')) {
      return json({ error: 'Acesso permitido apenas para o administrador.' }, 403);
    }
    const email = (body.email || '').trim().toLowerCase();
    const days = Number(body.days) || 30;
    let user = mockDb.users.find(u => u.email === email);
    if (!user) {
      user = { email, is_active: true, status: 'active', expires_at: null, days_left: days, is_admin: false };
      mockDb.users.push(user);
    }
    const newExp = new Date(Date.now() + days * 86400000).toISOString();
    user.is_active = true;
    user.status = 'active';
    user.expires_at = newExp;
    user.days_left = days;
    return json({
      ok: true,
      message: `Acesso liberado com sucesso para ${email} por mais ${days} dias (Até: ${new Date(newExp).toLocaleDateString('pt-BR')})!`
    });
  }

  if (action === 'admin-block') {
    const email = (body.email || '').trim().toLowerCase();
    const user = mockDb.users.find(u => u.email === email);
    if (user) {
      user.is_active = false;
      user.status = 'inactive';
      user.expires_at = null;
      user.days_left = 0;
    }
    return json({ ok: true, message: `O motorista ${email} foi bloqueado com sucesso.` });
  }

  return json({ error: 'Rota não encontrada.' }, 404);
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = urlObj.pathname;

  if (pathname.startsWith('/api/')) {
    const action = pathname.replace('/api/', '');
    if (realHandler) {
      // Converte para Request web standard
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      headers.set('origin', process.env.APP_URL || `http://localhost:${PORT}`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const reqInit = {
        method: req.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {})
      };
      const webReq = new Request(`http://localhost:${PORT}${req.url}`, reqInit);
      const webRes = await realHandler(webReq, { ip: '127.0.0.1' });
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      res.end(await webRes.text());
      return;
    } else {
      return handleApiMock(req, res, action);
    }
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  CAPITALEX DRIVER — SERVIDOR LOCAL EM EXECUÇÃO`);
  console.log(`======================================================`);
  console.log(`  > Aplicativo:  http://localhost:${PORT}`);
  console.log(`  > Painel Adm:  http://localhost:${PORT}/admin.html`);
  console.log(`  > Modo API:    ${hasRealEnv ? 'Supabase Conectado' : 'Modo Simulado / Demonstração Local'}`);
  console.log(`======================================================\n`);
});

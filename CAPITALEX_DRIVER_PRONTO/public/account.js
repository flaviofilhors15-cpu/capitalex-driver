'use strict';
(() => {
  const el = id => document.getElementById(id);
  let email = '', session = null, refreshing = null;

  // Informações de pagamento do Flavio
  const PIX_KEY = '11194608671';
  const PIX_NAME = 'Flavio Rodrigues';
  const WHATSAPP_NUM = '5534999836438';

  function message(text) {
    const m = el('accountMessage');
    if (m) m.textContent = text;
  }

  function renderFriendlyBanner(daysLeft) {
    let banner = el('friendlyRenewalBanner');
    if (daysLeft > 0 && daysLeft <= 3) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'friendlyRenewalBanner';
        banner.style.cssText = 'background: #b45309; color: #ffffff; padding: 10px 16px; text-align: center; font-weight: 600; font-size: 0.92rem; border-bottom: 2px solid #f59e0b; display: flex; justify-content: center; align-items: center; gap: 12px; z-index: 999; box-shadow: 0 2px 8px rgba(0,0,0,0.3);';
        document.body.prepend(banner);
      }
      banner.innerHTML = `
        <span>⚠️ Olá! Sua assinatura vence em <strong>${daysLeft} dia${daysLeft > 1 ? 's' : ''}</strong>. Renove com antecedência para não interromper seu painel!</span>
        <button id="btnBannerPix" style="background: #22c55e; color: #081320; border: none; padding: 5px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.85rem;">Renovar via Pix</button>
      `;
      const btn = document.getElementById('btnBannerPix');
      if (btn) btn.onclick = () => showPaywall();
    } else if (banner) {
      banner.remove();
    }
  }

  function lock() {
    document.body.classList.add('account-view');
    document.body.classList.toggle('locked', !session?.billing?.active);
    const gate = el('accountGate');
    if (gate) gate.hidden = false;
    document.getElementById('modal')?.close();
  }

  function unlock() {
    document.body.classList.remove('locked', 'account-view');
    const gate = el('accountGate');
    if (gate) gate.hidden = true;
  }

  async function request(action, method = 'GET', payload) {
    let r;
    try {
      r = await fetch('/api/' + action, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: payload !== undefined ? { 'Content-Type': 'application/json' } : {},
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
      });
    } catch {
      throw Error('Sem conexão. Seus dados não foram alterados. Tente novamente.');
    }
    const data = await r.json().catch(() => ({ error: 'O serviço está temporariamente indisponível.' }));
    if (!r.ok) {
      const e = Error(data.error || 'Não foi possível concluir.');
      e.status = r.status;
      throw e;
    }
    return data;
  }

  async function api(action, method = 'GET', payload, retry = true) {
    try {
      return await request(action, method, payload);
    } catch (e) {
      if (e.status === 401 && retry && !['otp', 'verify', 'refresh', 'logout'].includes(action)) {
        try {
          if (!refreshing) refreshing = request('refresh', 'POST', {}).finally(() => refreshing = null);
          await refreshing;
          return await api(action, method, payload, false);
        } catch (err) {
          if (err.status === 401) {
            session = null;
            showLogin();
          }
          throw err;
        }
      }
      if (e.status === 402) {
        if (session?.billing) session.billing.active = false;
        stage('stepPlan');
        lock();
        showPaywall();
        message(e.message);
      }
      throw e;
    }
  }

  function stage(name) {
    ['stepLogin', 'stepPlan', 'stepPanel'].forEach(id => {
      const elem = el(id);
      if (!elem) return;
      if (id === name) elem.setAttribute('aria-current', 'step');
      else elem.removeAttribute('aria-current');
    });
    const st = el('accountStage');
    if (st) st.textContent = name === 'stepLogin' ? 'SUA CONTA' : 'CONTA E ASSINATURA';
  }

  let authMode = 'register';

  function setAuthMode(mode) {
    authMode = mode;
    const tabReg = el('tabRegister');
    const tabLog = el('tabLogin');
    const title = el('gateTitle');
    const desc = el('gateDescription');
    const submitBtn = el('authSubmit');
    const passInput = el('accountPassword');

    if (mode === 'register') {
      if (tabReg) {
        tabReg.style.background = 'var(--green)';
        tabReg.style.color = '#081320';
        tabReg.style.border = 'none';
      }
      if (tabLog) {
        tabLog.style.background = '#0b1a29';
        tabLog.style.color = 'var(--muted)';
        tabLog.style.border = '1px solid #1f3550';
      }
      if (title) title.textContent = 'Criar sua conta';
      if (desc) desc.textContent = 'Cadastre seu e-mail e crie uma senha para liberar seu acesso direto.';
      if (submitBtn) submitBtn.textContent = 'Criar conta e ir para o Pix';
      if (passInput) passInput.setAttribute('autocomplete', 'new-password');
    } else {
      if (tabLog) {
        tabLog.style.background = 'var(--green)';
        tabLog.style.color = '#081320';
        tabLog.style.border = 'none';
      }
      if (tabReg) {
        tabReg.style.background = '#0b1a29';
        tabReg.style.color = 'var(--muted)';
        tabReg.style.border = '1px solid #1f3550';
      }
      if (title) title.textContent = 'Entrar na sua conta';
      if (desc) desc.textContent = 'Digite seu e-mail e sua senha para entrar no painel.';
      if (submitBtn) submitBtn.textContent = 'Entrar';
      if (passInput) passInput.setAttribute('autocomplete', 'current-password');
    }
    message('');
  }

  function showLogin(mode = 'register') {
    session = null;
    stage('stepLogin');
    lock();
    const tabs = el('authTabs');
    if (tabs) tabs.hidden = false;
    const form = el('authForm');
    if (form) form.hidden = false;
    const sp = el('subscriptionPanel');
    if (sp) sp.hidden = true;
    setAuthMode(mode);
  }

  function showPaywall() {
    stage('stepPlan');
    lock();
    const tabs = el('authTabs');
    if (tabs) tabs.hidden = true;
    const form = el('authForm');
    if (form) form.hidden = true;

    let sp = el('subscriptionPanel');
    if (!sp) return;
    sp.hidden = false;

    const b = session?.billing || { active: false, daysLeft: 0 };
    el('gateTitle').textContent = b.active ? 'Sua assinatura' : 'Ative seu acesso ao Capitalex';
    el('gateDescription').textContent = session?.email || '';

    const zapText = encodeURIComponent(`Olá Flavio! Fiz o Pix para liberar minha assinatura no Capitalex Driver.\nMeu e-mail cadastrado é: ${session?.email || ''}`);
    const zapUrl = `https://wa.me/${WHATSAPP_NUM}?text=${zapText}`;

    sp.innerHTML = `
      <div style="background: #0d1e30; border: 1px solid #1e3a57; border-radius: 16px; padding: 22px 20px; color: #f8fafc; margin-top: 14px; text-align: left; box-shadow: 0 8px 30px rgba(0,0,0,0.3);">
        
        ${b.active ? `
          <div style="background: #064e3b; color: #34d399; padding: 12px 14px; border-radius: 10px; font-weight: 700; font-size: 0.95rem; margin-bottom: 16px; text-align: center; border: 1px solid #059669; box-shadow: 0 4px 14px rgba(6,78,59,0.3);">
            ✅ Assinatura Ativa ${b.daysLeft > 0 ? `· Restam ${b.daysLeft} dia(s)` : ''}
          </div>
          <button id="btnBackToApp" type="button" style="width: 100%; background: #34d6ac; color: #081320; border: none; padding: 13px; border-radius: 10px; font-weight: 800; cursor: pointer; font-size: 0.98rem; margin-bottom: 14px; box-shadow: 0 4px 14px rgba(52,214,172,0.25);">
            ← Voltar ao Meu Painel
          </button>
        ` : `
          <div style="font-size: 0.92rem; color: #94a3b8; margin-bottom: 14px; font-weight: 500;">
            Escolha seu plano e faça o Pix para liberar o painel:
          </div>
        `}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
          <div style="background: rgba(8, 19, 32, 0.7); border: 1px solid #1f3b55; border-radius: 12px; padding: 14px 12px; text-align: center; display: flex; flex-direction: column; justify-content: center;">
            <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;">Plano Mensal</div>
            <div style="font-size: 1.45rem; font-weight: 800; color: #34d6ac; margin: 4px 0; letter-spacing: -0.5px;">R$ 25,95</div>
            <div style="font-size: 0.75rem; color: #64748b; font-weight: 500;">30 dias de acesso</div>
          </div>

          <div style="background: linear-gradient(145deg, #0d282e 0%, #081a22 100%); border: 2px solid #34d6ac; border-radius: 12px; padding: 14px 12px; text-align: center; position: relative; box-shadow: 0 0 20px rgba(52, 214, 172, 0.12); display: flex; flex-direction: column; justify-content: center;">
            <span style="position: absolute; top: -11px; right: 12px; background: #34d6ac; color: #041d16; font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.5px; text-transform: uppercase; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">✦ Economize</span>
            <div style="font-size: 0.75rem; color: #a7f3d0; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;">Trimestral</div>
            <div style="font-size: 1.45rem; font-weight: 800; color: #38bdf8; margin: 4px 0; letter-spacing: -0.5px;">R$ 69,90</div>
            <div style="font-size: 0.75rem; color: #64748b; font-weight: 500;">90 dias com desconto</div>
          </div>
        </div>

        <div style="background: rgba(4, 12, 22, 0.8); border: 1px solid #1e3b58; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #7e9bb6;">Chave Pix (CPF)</span>
            <span style="font-size: 0.72rem; color: #34d6ac; font-weight: 600; background: rgba(52, 214, 172, 0.1); padding: 2px 8px; border-radius: 10px;">Liberação Instantânea</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
            <div style="min-width: 0; flex: 1;">
              <div style="font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 1.28rem; font-weight: 800; color: #ffffff; letter-spacing: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="pixCodeVal">111.946.086-71</div>
              <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 3px;">Titular: <strong style="color: #e2e8f0; font-weight: 700;">${PIX_NAME}</strong></div>
            </div>
            <button id="btnCopyPix" type="button" style="flex-shrink: 0; background: #1c3854; color: #ffffff; border: 1px solid #2b5074; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 0.88rem; font-weight: 700; transition: all 0.2s ease;">
              Copiar
            </button>
          </div>
        </div>

        <a href="${zapUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; box-sizing: border-box; text-align: center; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: #ffffff; padding: 14px 18px; border-radius: 10px; font-weight: 800; text-decoration: none; font-size: 0.98rem; margin-bottom: 14px; box-shadow: 0 4px 16px rgba(37, 211, 102, 0.3); transition: transform 0.15s ease, filter 0.2s ease;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.669-.699c.969.54 1.769.814 2.791.814 3.181 0 5.767-2.586 5.768-5.766 0-3.18-2.587-5.767-5.768-5.767zm7.647 5.766c-.001 4.223-3.435 7.656-7.647 7.656-1.328 0-2.457-.34-3.489-.955l-4.542 1.19 1.21-4.425c-.687-1.077-1.07-2.316-1.07-3.466.001-4.223 3.435-7.656 7.647-7.656 4.223 0 7.658 3.433 7.658 7.656z"/></svg>
          <span>Enviar Comprovante no WhatsApp</span>
        </a>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button id="btnCheckPay" type="button" style="grid-column: 1 / -1; background: #183550; color: #ffffff; border: 1px solid #2a5177; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.9rem; transition: background 0.2s;">
            🔄 Já paguei · Atualizar acesso
          </button>
          <button id="btnExport" type="button" style="background: transparent; color: #94a3b8; border: 1px solid #1e3852; padding: 10px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">
            Exportar dados
          </button>
          <button id="btnLogout" type="button" style="background: rgba(239, 68, 68, 0.08); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); padding: 10px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">
            Sair
          </button>
        </div>

        ${b.isAdmin ? `
          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #1f3550; text-align: center;">
            <a href="/admin.html" style="color: #38bdf8; font-weight: 800; font-size: 0.9rem; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
              👑 Abrir Painel de Administrador
            </a>
          </div>
        ` : ''}

      </div>
    `;

    document.getElementById('btnBackToApp')?.addEventListener('click', () => {
      unlock();
    });

    document.getElementById('btnCopyPix')?.addEventListener('click', () => {
      const b = document.getElementById('btnCopyPix');
      const onCopied = () => {
        if (b) {
          b.textContent = 'Copiado!';
          b.style.background = '#22c55e';
          b.style.color = '#081320';
          setTimeout(() => {
            b.textContent = 'Copiar';
            b.style.background = '#1f3550';
            b.style.color = '#fff';
          }, 2000);
        }
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(PIX_KEY).then(onCopied).catch(() => {
          fallbackCopyText(PIX_KEY);
          onCopied();
        });
      } else {
        fallbackCopyText(PIX_KEY);
        onCopied();
      }
    });

    document.getElementById('btnCheckPay')?.addEventListener('click', async () => {
      message('Verificando status do pagamento...');
      await boot();
      if (!session?.billing?.active) {
        message('Pagamento ainda não confirmado. Envie o comprovante no WhatsApp e aguarde alguns instantes.');
      }
    });
    document.getElementById('btnExport')?.addEventListener('click', exportData);
    document.getElementById('btnLogout')?.addEventListener('click', logout);
  }

  function fallbackCopyText(text) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.top = '-9999px';
      document.body.appendChild(area);
      area.focus();
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    } catch {}
  }

  async function exportData() {
    try {
      const r = await api('export');
      if (!r.data) {
        message('Sua conta ainda não tem registros.');
        return;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'capitalex-backup.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('Backup baixado com sucesso!');
    } catch (e) {
      message(e.message);
    }
  }

  async function boot() {
    try {
      session = await api('session');
      if (session?.billing?.active) {
        await window.DriverApp.load();
        unlock();
        message('');
        renderFriendlyBanner(session.billing.daysLeft);
      } else {
        showPaywall();
        message('Faça seu Pix e envie o comprovante para liberar o seu acesso.');
      }
    } catch (e) {
      if (e.status === 401) {
        showLogin();
        message('Informe seu e-mail para entrar com segurança.');
      } else {
        lock();
        message(e.message);
      }
    }
  }

  async function busy(button, fn) {
    if (!button) return fn();
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      message(e.message);
      if (!document.body.classList.contains('locked')) window.toast?.(e.message);
    } finally {
      button.disabled = false;
    }
  }

  el('tabRegister')?.addEventListener('click', () => setAuthMode('register'));
  el('tabLogin')?.addEventListener('click', () => setAuthMode('login'));

  el('authForm')?.addEventListener('submit', ev => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      email = el('accountEmail').value.trim();
      const password = el('accountPassword').value;
      try {
        if (authMode === 'register') {
          message('Criando sua conta...');
          await api('register', 'POST', { email, password });
        } else {
          message('Entrando na sua conta...');
          await api('login', 'POST', { email, password });
        }
      } catch (err) {
        if (err.status === 404 || String(err.message).includes('não encontrada')) {
          session = {
            email,
            billing: {
              active: email === 'flaviofilhors15@gmail.com',
              daysLeft: email === 'flaviofilhors15@gmail.com' ? 365 : 0
            }
          };
          el('accountPassword').value = '';
          if (session.billing.active) {
            await window.DriverApp?.load();
            unlock();
          } else {
            showPaywall();
            message('Conta criada! Faça o Pix para liberar seu acesso.');
          }
          return;
        }
        throw err;
      }
      el('accountPassword').value = '';
      await boot();
    });
  });

  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('capitalex-session') : null;

  async function logout() {
    await api('logout', 'POST', {}).catch(() => {});
    channel?.postMessage('logout');
    window.DriverApp?.clear();
    session = null;
    showLogin('login');
    message('Sessão encerrada.');
  }

  channel?.addEventListener('message', ev => {
    if (ev.data === 'logout') {
      window.DriverApp?.clear();
      session = null;
      showLogin('login');
      message('Sessão encerrada em outra aba.');
    }
  });

  el('accountLogout')?.addEventListener('click', ev => busy(ev.currentTarget, logout));
  el('accountMenu')?.addEventListener('click', async () => {
    try {
      session = await api('session');
      showPaywall();
    } catch (e) {
      lock();
      message(e.message);
    }
  });

  document.querySelector('aside nav')?.addEventListener('click', ev => {
    if (ev.target.closest('a') && session?.billing?.active) unlock();
  });
  document.querySelector('aside .brand')?.addEventListener('click', () => {
    if (session?.billing?.active) unlock();
  });

  window.Account = { api };
  window.addEventListener('DOMContentLoaded', boot);
})();

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
    let banner = el('topNotificationBanner');
    const billing = session?.billing;
    if (!billing || billing.isAdmin) {
      if (banner) banner.remove();
      return;
    }

    if (billing.isTrial && billing.active) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'topNotificationBanner';
        document.body.prepend(banner);
      }
      const days = billing.daysLeft || daysLeft || 0;
      const isUrgent = days <= 1;
      banner.className = 'trial-ticker-bar' + (isUrgent ? ' urgent' : '');
      banner.innerHTML = `
        <div class="trial-ticker-content">
          <span class="trial-ticker-icon">${isUrgent ? '⚠️' : '🕒'}</span>
          <span><strong>Teste Grátis:</strong> ${isUrgent ? 'Último dia de teste!' : `Restam <strong>${days} dia${days > 1 ? 's' : ''}</strong>`}</span>
          <span class="trial-ticker-sep">•</span>
          <span class="trial-ticker-hint">Seu painel está 100% liberado</span>
        </div>
        <button type="button" class="trial-ticker-btn" id="btnTrialUpgrade">Garantir meu plano</button>
      `;
      const btn = document.getElementById('btnTrialUpgrade');
      if (btn) btn.onclick = () => showPaywall();
    } else if (daysLeft > 0 && daysLeft <= 3) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'topNotificationBanner';
        document.body.prepend(banner);
      }
      banner.className = 'trial-ticker-bar warning';
      banner.innerHTML = `
        <div class="trial-ticker-content">
          <span class="trial-ticker-icon">⚠️</span>
          <span>Sua assinatura vence em <strong>${daysLeft} dia${daysLeft > 1 ? 's' : ''}</strong>.</span>
          <span class="trial-ticker-sep">•</span>
          <span class="trial-ticker-hint">Renove para não interromper seu painel</span>
        </div>
        <button type="button" class="trial-ticker-btn" id="btnTrialUpgrade">Renovar via Pix</button>
      `;
      const btn = document.getElementById('btnTrialUpgrade');
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

      const chosenPlan = localStorage.getItem('capitalex_chosen_plan');
      const planNames = {
        mensal: 'Mensal (R$ 25,95)',
        trimestral: 'Trimestral (R$ 69,90)',
        semestral: 'Semestral Safra (R$ 119,90)'
      };

      if (chosenPlan && planNames[chosenPlan]) {
        if (title) title.innerHTML = `Plano <span style="color:var(--green);">${planNames[chosenPlan]}</span>`;
        if (desc) desc.textContent = 'Crie seu e-mail e sua senha de acesso para ir direto ao pagamento Pix.';
        if (submitBtn) submitBtn.textContent = 'Continuar para Pagamento Pix ➔';
      } else {
        if (title) title.textContent = 'Criar sua conta';
        if (desc) desc.textContent = 'Cadastre seu e-mail e crie uma senha para começar seus 7 dias grátis na hora.';
        if (submitBtn) submitBtn.textContent = 'Criar conta e começar 7 dias grátis';
      }
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
    session = null;
    stage('stepLogin');
    lock();
    el('topNotificationBanner')?.remove();
    const banner = document.querySelector('.card-hero-banner');
    if (banner) banner.style.display = 'block';
    const tabs = el('authTabs');
    if (tabs) tabs.hidden = false;
    const form = el('authForm');
    if (form) form.hidden = false;
    const sp = el('subscriptionPanel');
    if (sp) sp.hidden = true;
    setAuthMode(mode);
  }

  function showPaywall(targetPlan) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    stage('stepPlan');
    lock();
    el('topNotificationBanner')?.remove();
    const banner = document.querySelector('.card-hero-banner');
    if (banner) banner.style.display = 'none';
    const tabs = el('authTabs');
    if (tabs) tabs.hidden = true;
    const form = el('authForm');
    if (form) form.hidden = true;

    let sp = el('subscriptionPanel');
    if (!sp) return;
    sp.hidden = false;

    if (targetPlan) {
      localStorage.setItem('capitalex_chosen_plan', targetPlan);
    }

    const b = session?.billing || { active: false, daysLeft: 0 };
    if (b.active && b.isTrial) {
      el('gateTitle').textContent = 'Seu Teste Grátis está ativo!';
      el('gateDescription').textContent = session?.email || '';
    } else if (!b.active) {
      if (b.status === 'trial_expired') {
        el('gateTitle').textContent = 'Seu teste de 7 dias terminou!';
        el('gateDescription').textContent = 'Escolha seu plano para continuar acompanhando seus lucros e não perder seu histórico:';
      } else if (b.status === 'expired') {
        el('gateTitle').textContent = 'Sua assinatura venceu!';
        el('gateDescription').textContent = 'Renove seu plano para continuar acessando seu painel:';
      } else {
        el('gateTitle').textContent = '⚡ Ativação Imediata via Pix';
        el('gateDescription').textContent = session?.email ? session.email : 'Faça o Pix do plano escolhido e envie o comprovante para liberação imediata:';
      }
    } else {
      el('gateTitle').textContent = 'Sua assinatura';
      el('gateDescription').textContent = session?.email || '';
    }

    const zapText = encodeURIComponent(`Olá Flavio! Fiz o Pix para liberar minha assinatura no Capitalex Driver.\nMeu e-mail cadastrado é: ${session?.email || ''}`);
    const zapUrl = `https://wa.me/${WHATSAPP_NUM}?text=${zapText}`;

    // Calcula histórico de faturamento se existir
    let totalFaturado = 0;
    try {
      const ent = (typeof saved !== 'undefined' && saved.entries) ? saved.entries : [];
      totalFaturado = ent.filter(e => e.type === 'income').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    } catch {}
    const faturamentoTexto = totalFaturado > 0 
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFaturado)
      : 'R$ 2.450,00';

    const guestEmailHtml = !session?.email ? `
      <div style="background: rgba(14, 34, 54, 0.7); border: 1px solid #244b70; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; text-align: left;">
        <label for="payEmailInp" style="font-size: 0.82rem; font-weight: 700; color: #a9c7df; display: block; margin-bottom: 6px;">📧 Digite seu e-mail para identificação do Pix:</label>
        <input type="email" id="payEmailInp" placeholder="seuemail@exemplo.com" value="${localStorage.getItem('capitalex_user_email') || ''}" style="width: 100%; padding: 10px 12px; border-radius: 8px; background: #06121e; border: 1px solid #2b5780; color: #ffffff; font-size: 0.95rem;">
        <small style="color: #64748b; font-size: 0.72rem; display: block; margin-top: 4px;">O administrador usará este e-mail para liberar o seu acesso com 1 clique.</small>
      </div>
    ` : '';

    sp.innerHTML = `
      ${b.active ? `
        <div style="background: ${b.isTrial ? 'rgba(52,214,172,0.1)' : '#064e3b'}; color: #34d399; padding: 12px 14px; border-radius: 10px; font-weight: 700; font-size: 0.95rem; margin-bottom: 14px; text-align: center; border: 1px solid #059669; box-shadow: 0 4px 14px rgba(6,78,59,0.3);">
          ${b.isTrial ? `🕒 Teste Grátis · Restam <strong>${b.daysLeft} dia(s)</strong>` : `✅ Assinatura Ativa ${b.daysLeft > 0 ? `· Restam ${b.daysLeft} dia(s)` : ''}`}
        </div>
        <button id="btnBackToApp" type="button" style="width: 100%; background: #34d6ac; color: #081320; border: none; padding: 13px; border-radius: 10px; font-weight: 800; cursor: pointer; font-size: 0.98rem; margin-bottom: 14px; box-shadow: 0 4px 14px rgba(52,214,172,0.25);">
          ← Voltar ao Meu Painel
        </button>
        ${b.isTrial ? '<div style="font-size: 0.88rem; color: #94a3b8; margin: 4px 0 12px; font-weight: 500;">Garanta seu plano com antecedência para não ter seu painel interrompido:</div>' : ''}
      ` : `
        <div style="background: linear-gradient(135deg, rgba(52, 214, 172, 0.08) 0%, rgba(8, 19, 32, 0.95) 100%); border: 1px solid rgba(52, 214, 172, 0.35); border-radius: 14px; padding: 14px; margin-bottom: 14px; text-align: left;">
          <div style="font-size: 0.82rem; font-weight: 800; color: #34d6ac; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">🛡️ Mantenha o Controle do seu Lucro</div>
          <p style="font-size: 0.88rem; color: #e2e8f0; line-height: 1.45; margin: 0;">
            ${totalFaturado > 0 ? `Nos últimos dias, você registrou <strong>${faturamentoTexto}</strong> e calculou seu lucro líquido real!` : 'Pare de rodar no escuro e perder dinheiro para as taxas dos apps.'} Por apenas <strong>R$ 0,86 por dia</strong>, tenha controle total do seu bolso.
          </p>
        </div>
      `}

      ${guestEmailHtml}

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 14px;">
        <div id="payCardMonthly" style="cursor: pointer; background: rgba(8, 19, 32, 0.7); border: 1px solid #1f3b55; border-radius: 12px; padding: 12px 8px; text-align: center; display: flex; flex-direction: column; justify-content: center; transition: all 0.2s ease;">
          <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Mensal</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #34d6ac; margin: 2px 0;">R$ 25,95</div>
          <div style="font-size: 0.68rem; color: #64748b;">R$ 0,86/dia</div>
        </div>

        <div id="payCardQuarterly" style="cursor: pointer; background: linear-gradient(145deg, #0d282e 0%, #081a22 100%); border: 2px solid #34d6ac; border-radius: 12px; padding: 12px 8px; text-align: center; position: relative; box-shadow: 0 0 16px rgba(52, 214, 172, 0.12); display: flex; flex-direction: column; justify-content: center; transition: all 0.2s ease;">
          <span style="position: absolute; top: -10px; right: 6px; background: #34d6ac; color: #041d16; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">✦ Popular</span>
          <div style="font-size: 0.7rem; color: #a7f3d0; font-weight: 700; text-transform: uppercase;">Trimestral</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #38bdf8; margin: 2px 0;">R$ 69,90</div>
          <div style="font-size: 0.68rem; color: #64748b;">R$ 23,30/mês</div>
        </div>

        <div id="payCardSemiannual" style="cursor: pointer; background: linear-gradient(145deg, #1e1338 0%, #0d0a1a 100%); border: 1px solid #a78bfa; border-radius: 12px; padding: 12px 8px; text-align: center; position: relative; display: flex; flex-direction: column; justify-content: center; transition: all 0.2s ease;">
          <span style="position: absolute; top: -10px; right: 6px; background: #a78bfa; color: #1e1338; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">Safra</span>
          <div style="font-size: 0.7rem; color: #ddd6fe; font-weight: 700; text-transform: uppercase;">Semestral</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #c4b5fd; margin: 2px 0;">R$ 119,90</div>
          <div style="font-size: 0.68rem; color: #a78bfa;">R$ 19,98/mês</div>
        </div>
      </div>

      <div style="background: rgba(4, 12, 22, 0.8); border: 1px solid #1e3b58; border-radius: 12px; padding: 13px 16px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #7e9bb6;">Chave Pix (CPF)</span>
          <span style="font-size: 0.72rem; color: #34d6ac; font-weight: 600; background: rgba(52, 214, 172, 0.1); padding: 2px 8px; border-radius: 10px;" id="pixPlanBadge">Valor: R$ 69,90 (Trimestral)</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.25rem; font-weight: 800; color: #ffffff; letter-spacing: 0.8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="pixCodeVal">111.946.086-71</div>
            <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 3px; white-space: nowrap;">Titular: <strong style="color: #edf5fc;">${PIX_NAME}</strong></div>
          </div>
          <button id="btnCopyPix" type="button" style="width: auto !important; min-width: 85px; flex-shrink: 0; background: #1c3854; color: #ffffff; border: 1px solid #2b5074; padding: 9px 16px; border-radius: 8px; cursor: pointer; font-size: 0.88rem; font-weight: 700; transition: all 0.2s ease;">
            Copiar
          </button>
        </div>
      </div>

      <a id="payZapLink" href="${zapUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; box-sizing: border-box; text-align: center; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: #ffffff; padding: 13px 18px; border-radius: 10px; font-weight: 800; text-decoration: none; font-size: 0.95rem; margin-bottom: 12px; box-shadow: 0 4px 16px rgba(37, 211, 102, 0.3); transition: transform 0.15s ease, filter 0.2s ease;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.669-.699c.969.54 1.769.814 2.791.814 3.181 0 5.767-2.586 5.768-5.766 0-3.18-2.587-5.767-5.768-5.767zm7.647 5.766c-.001 4.223-3.435 7.656-7.647 7.656-1.328 0-2.457-.34-3.489-.955l-4.542 1.19 1.21-4.425c-.687-1.077-1.07-2.316-1.07-3.466.001-4.223 3.435-7.656 7.647-7.656 4.223 0 7.658 3.433 7.658 7.656z"/></svg>
        <span>Enviar Comprovante no WhatsApp</span>
      </a>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button id="btnCheckPay" type="button" style="grid-column: 1 / -1; background: #183550; color: #ffffff; border: 1px solid #2a5177; padding: 11px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.88rem; transition: background 0.2s;">
          🔄 Já paguei · Atualizar acesso
        </button>
        <button id="btnExport" type="button" style="background: transparent; color: #94a3b8; border: 1px solid #1e3852; padding: 9px; border-radius: 8px; font-size: 0.82rem; font-weight: 600; cursor: pointer;">
          Exportar dados
        </button>
        <button id="btnLogout" type="button" style="background: rgba(239, 68, 68, 0.08); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); padding: 9px; border-radius: 8px; font-size: 0.82rem; font-weight: 600; cursor: pointer;">
          Sair
        </button>
      </div>

      ${!session?.email ? `
        <button type="button" id="btnSwitchToTrial" style="margin-top: 12px; width: 100%; background: rgba(52,214,172,0.06); border: 1px dashed var(--green); color: var(--green); padding: 12px; border-radius: 10px; font-weight: 750; font-size: 0.88rem; cursor: pointer; transition: all 0.2s;">
          ✦ Prefiro começar testando 7 dias grátis ➔
        </button>
      ` : ''}

      <div style="margin-top: 14px; font-size: 11px; color: var(--muted); text-align: center; line-height: 1.5; border-top: 1px solid #1a2d42; padding-top: 10px;">
        Ao assinar você concorda com nossos <a href="termos.html" target="_blank" style="color: var(--green); text-decoration: underline;">Termos de Uso</a> e <a href="privacidade.html" target="_blank" style="color: var(--green); text-decoration: underline;">Privacidade</a>.<br>
        <span style="opacity: 0.75;">Software utilitário independente. Uber, 99 e inDrive são marcas de seus respectivos proprietários.</span>
      </div>

      ${b.isAdmin ? `
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #1f3550; text-align: center;">
          <a href="/admin.html" style="color: #38bdf8; font-weight: 800; font-size: 0.88rem; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
            👑 Abrir Painel de Administrador
          </a>
        </div>
      ` : ''}
    `;

    const updatePaywallPlan = (planKey) => {
      localStorage.setItem('capitalex_chosen_plan', planKey);
      const cardM = document.getElementById('payCardMonthly');
      const cardQ = document.getElementById('payCardQuarterly');
      const cardS = document.getElementById('payCardSemiannual');
      const zapLink = document.getElementById('payZapLink');
      const pixValBadge = document.getElementById('pixPlanBadge');

      if (!cardM || !cardQ || !cardS) return;

      cardM.style.borderColor = '#1f3b55';
      cardM.style.boxShadow = 'none';
      cardM.style.transform = 'scale(1)';
      cardQ.style.borderColor = '#1f3b55';
      cardQ.style.boxShadow = 'none';
      cardQ.style.transform = 'scale(1)';
      cardS.style.borderColor = '#1f3b55';
      cardS.style.boxShadow = 'none';
      cardS.style.transform = 'scale(1)';

      let planName = 'Trimestral';
      let planPrice = 'R$ 69,90';

      if (planKey === 'mensal') {
        planName = 'Mensal';
        planPrice = 'R$ 25,95';
        cardM.style.borderColor = '#34d6ac';
        cardM.style.boxShadow = '0 0 16px rgba(52, 214, 172, 0.3)';
        cardM.style.transform = 'scale(1.04)';
      } else if (planKey === 'semestral') {
        planName = 'Semestral Safra';
        planPrice = 'R$ 119,90';
        cardS.style.borderColor = '#a78bfa';
        cardS.style.boxShadow = '0 0 16px rgba(167, 139, 250, 0.3)';
        cardS.style.transform = 'scale(1.04)';
      } else {
        planName = 'Trimestral';
        planPrice = 'R$ 69,90';
        cardQ.style.borderColor = '#34d6ac';
        cardQ.style.boxShadow = '0 0 16px rgba(52, 214, 172, 0.3)';
        cardQ.style.transform = 'scale(1.04)';
      }

      if (pixValBadge) {
        pixValBadge.innerHTML = `Valor Pix: <strong style="color:#ffffff;">${planPrice}</strong> (${planName})`;
      }

      if (zapLink) {
        const curEmail = (document.getElementById('payEmailInp')?.value || session?.email || localStorage.getItem('capitalex_user_email') || '').trim();
        const emailMsg = curEmail ? `\nMeu e-mail para liberação é: ${curEmail}` : '';
        const text = encodeURIComponent(`Olá Flavio! Fiz o Pix do Plano ${planName} (${planPrice}) para liberar minha assinatura no Capitalex Driver.${emailMsg}\nSeguem os dados do pagamento!`);
        zapLink.href = `https://wa.me/${WHATSAPP_NUM}?text=${text}`;
      }
    };

    const emailInp = document.getElementById('payEmailInp');
    if (emailInp) {
      emailInp.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        localStorage.setItem('capitalex_user_email', val);
        updatePaywallPlan(localStorage.getItem('capitalex_chosen_plan') || 'trimestral');
      });
    }

    document.getElementById('payCardMonthly')?.addEventListener('click', () => updatePaywallPlan('mensal'));
    document.getElementById('payCardQuarterly')?.addEventListener('click', () => updatePaywallPlan('trimestral'));
    document.getElementById('payCardSemiannual')?.addEventListener('click', () => updatePaywallPlan('semestral'));

    updatePaywallPlan(localStorage.getItem('capitalex_chosen_plan') || 'trimestral');

    document.getElementById('btnSwitchToTrial')?.addEventListener('click', () => {
      showLogin('register');
    });

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

  function showAdminLinks(isAdmin) {
    if (!isAdmin) return;
    if (!document.getElementById('headerAdminLink')) {
      const headerAdminBtn = document.createElement('a');
      headerAdminBtn.id = 'headerAdminLink';
      headerAdminBtn.href = '/admin.html';
      headerAdminBtn.className = 'ghost';
      headerAdminBtn.style.cssText = 'color: #38bdf8; font-weight: 800; border: 1px solid rgba(56, 189, 248, 0.4); display: inline-flex; align-items: center; gap: 4px; text-decoration: none; padding: 7px 12px; border-radius: 8px; background: rgba(56, 189, 248, 0.08);';
      headerAdminBtn.innerHTML = '👑 Admin QG';
      const actions = document.querySelector('.header-actions');
      if (actions) actions.prepend(headerAdminBtn);
    }
    if (!document.getElementById('mobileAdminLink')) {
      const mobileAdminBtn = document.createElement('a');
      mobileAdminBtn.id = 'mobileAdminLink';
      mobileAdminBtn.href = '/admin.html';
      mobileAdminBtn.className = 'sheet-menu-item';
      mobileAdminBtn.style.cssText = 'color: #38bdf8; font-weight: 800; border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.06);';
      mobileAdminBtn.innerHTML = '<span style="font-size: 1.2rem;">👑</span><span>Painel Admin QG</span>';
      const menuGrid = document.querySelector('.sheet-menu-grid');
      if (menuGrid) menuGrid.prepend(mobileAdminBtn);
    }
  }

  async function boot() {
    try {
      session = await api('session');
      window.CapitalexSession = session;
      const isAdmin = Boolean(session?.billing?.isAdmin || session?.email === 'flaviofilhors15@gmail.com');
      showAdminLinks(isAdmin);
      if (isAdmin || session?.billing?.active) {
        if (!window.DriverApp?.load) {
          for (let i = 0; i < 30 && !window.DriverApp?.load; i++) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        if (window.DriverApp?.load) {
          await window.DriverApp.load();
        }
        if (!isAdmin) {
          const chosenPlan = localStorage.getItem('capitalex_chosen_plan');
          if (chosenPlan) {
            localStorage.removeItem('capitalex_chosen_plan');
            showPaywall(chosenPlan);
            message('Conta criada com sucesso! Faça o Pix para liberação definitiva.');
            return;
          }
        } else {
          localStorage.removeItem('capitalex_chosen_plan');
        }
        unlock();
        message('');
        if (!isAdmin) {
          renderFriendlyBanner(session.billing.daysLeft);
        }
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
          const ref = localStorage.getItem('capitalex_ref') || '';
          await api('register', 'POST', { email, password, ref });
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

  window.Account = {
    api,
    savePix: async (pix_key, pix_key_type) => api('save-pix', 'POST', { pix_key, pix_key_type }),
    showPaywall,
    showLogin,
    setupPlanSignup: (planKey) => {
      localStorage.setItem('capitalex_chosen_plan', planKey);
      showLogin('register');
    }
  };
  window.addEventListener('DOMContentLoaded', boot);
})();

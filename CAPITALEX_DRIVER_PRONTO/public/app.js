'use strict';
const KEY='capitalex.driver.v2';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n||0);
const number=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(n||0);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const displayDate=s=>new Date(s+'T12:00:00').toLocaleDateString('pt-BR');
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const defaults=()=>({version:2,profile:{name:'',vehicle:'',odometer:0,serviceAt:0,consumption:0},goals:{daily:300,monthly:6000,reserve:10000},reservePerKm:0.15,entries:[],funds:[],trash:[]});
let saved=defaults(),demo=null,route='dashboard',period='today',formContext=null,undo=null,toastTimer,loadedRaw=null,storageIssue='',tabConflict=false,dirty=false,chartInitializers=[];
let hideValues=localStorage.getItem('capitalex_hide_values')==='true';
window.togglePrivacy=function(){hideValues=!hideValues;localStorage.setItem('capitalex_hide_values',hideValues);render();};
const secretMoney=n=>hideValues?'R$ •••••':money(n);
const ALLOWED_APPS=['Uber','99','inDrive','Particular','Outros'];
const ALLOWED_CATEGORIES=['Combustível','Alimentação','Manutenção','Seguro','Aluguel do veículo','Parcela do veículo','Celular','Pedágio','Estacionamento','Impostos e taxas','Outros'];
let cloudRevision=0, cloudPrevious=null, saving=false;
const state=()=>demo||saved;
const paths={dashboard:['Visão geral','O resultado do seu trabalho, sem complicação.','M3 10l9-7 9 7v10H3z M9 20v-7h6v7'],corridas:['Ganhos e corridas','Registre cada corrida ou o total do dia.','M4 16h16l-2-8H6z M7 16v3 M17 16v3 M7 12h10'],gastos:['Despesas','Entenda o que pesa no seu resultado.','M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6'],calculadora:['Calculadora','Raio-X da corrida antes de aceitar','M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z M16 2v4 M8 2v4 M3 10h18 M9 15h6'],veiculo:['Meu veículo','Quilometragem e manutenção sob controle.','M4 16h16l-2-8H6z M7 16v3 M17 16v3'],investimentos:['Caixinhas e Objetivos','Dinheiro separado para os seus projetos.','M12 3v18 M17 7H9a3 3 0 000 6h6a3 3 0 010 6H6'],relatorios:['Relatórios','Compare os resultados do período selecionado.','M4 20V10 M10 20V4 M16 20v-8 M22 20H2'],metas:['Minhas metas','Objetivos claros para trabalhar com direção.','M21 12a9 9 0 11-9-9 M12 8a4 4 0 104 4 M12 12l9-9 M16 3h5v5'],perfil:['Perfil e backup','Seus dados, preferências e cópias de segurança.','M16 7a4 4 0 11-8 0 4 4 0 018 0 M4 21v-3a8 8 0 0116 0v3']};
window.DriverApp = {
  async load() {
    if (!window.Account?.api) return;
    const r = await window.Account.api('data');
    const data = r.data ? parseBackup(JSON.stringify(r.data)) : defaults();
    saved = data; cloudRevision = r.revision; cloudPrevious = r.previous; loadedRaw = JSON.stringify(data); storageIssue = ''; tabConflict = false; demo = null; render();
  },
  clear() { saved = defaults(); cloudRevision = 0; cloudPrevious = null; loadedRaw = null; demo = null; dirty = false; $('#modal')?.close(); render(); }
};
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00:00'))&&dateKey(new Date(s+'T12:00:00'))===s;}
function finite(n,min=0){return typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=1e9;}
function validBackup(s){
 try{
  const text=(v,max,empty=true)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0);
  const amount=v=>finite(v,.01)&&v<=1e7&&Math.abs(v*100-Math.round(v*100))<.0001;
  const goalAmount=v=>finite(v,0)&&v<=1e7&&Math.abs(v*100-Math.round(v*100))<.0001;
  const entry=e=>e&&text(e.id,100,false)&&validDate(e.date)&&e.date>='2000-01-01'&&e.date<=dateKey()&&amount(e.amount)&&text(e.description,160)&&(['income','expense'].includes(e.type))&&(e.type==='expense'?ALLOWED_CATEGORIES.includes(e.category):(['daily','ride'].includes(e.mode)&&finite(e.km)&&e.km<=100000&&finite(e.hours)&&e.hours<=24&&Number.isInteger(e.count)&&e.count>=0&&e.count<=10000&&(e.mode==='ride'?(ALLOWED_APPS.includes(e.app)&&e.count===1):e.app==='Todos')&&(!e.breakdown||(e.mode==='daily'&&typeof e.breakdown==='object'&&!Array.isArray(e.breakdown)&&Object.keys(e.breakdown).every(k=>ALLOWED_APPS.includes(k))&&Object.values(e.breakdown).every(v=>finite(v)&&v<=1e7&&Math.abs(v*100-Math.round(v*100))<.0001)&&Math.abs(Object.values(e.breakdown).reduce((a,b)=>a+b,0)-e.amount)<.001))));
  const fund=f=>f&&text(f.id,100,false)&&validDate(f.date)&&f.date>='2000-01-01'&&f.date<=dateKey()&&text(f.name,100,false)&&amount(f.amount);
  if(!s||s.version!==2||!s.profile||!text(s.profile.name,60)||!text(s.profile.vehicle,100)||!['odometer','serviceAt','consumption'].every(k=>finite(s.profile[k]))||s.profile.consumption>100||s.profile.odometer>1e7||s.profile.serviceAt>1e7||!s.goals||!['daily','monthly','reserve'].every(k=>goalAmount(s.goals[k]))||!finite(s.reservePerKm)||s.reservePerKm>100||!Array.isArray(s.entries)||s.entries.length>50000||!s.entries.every(entry)||!Array.isArray(s.funds)||s.funds.length>10000||!s.funds.every(fund))return false;
  const ids=s.entries.concat(s.funds).map(e=>e.id);if(new Set(ids).size!==ids.length)return false;
  const days=new Map();for(const e of s.entries.filter(e=>e.type==='income')){const d=days.get(e.date)||{hours:0,count:0,daily:false};d.hours+=e.hours;d.count++;d.daily=d.daily||e.mode==='daily';if(d.hours>24.000001||(d.daily&&d.count>1))return false;days.set(e.date,d);}
  if(s.trash!==undefined&&(!Array.isArray(s.trash)||s.trash.length>5000||!s.trash.every(t=>t&&text(t.trashId,100,false)&&validDate(t.deletedAt)&&['entries','funds'].includes(t.key)&&(t.key==='entries'?entry(t.item):fund(t.item)))||new Set(s.trash.map(t=>t.trashId)).size!==s.trash.length))return false;
  return true;
 }catch(e){return false;}
}
function parseBackup(raw){const data=JSON.parse(raw,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('Chave inválida');return value;});if(!validBackup(data))throw Error('Backup inválido');if(!data.trash)data.trash=[];return data;}
async function commit(next,msg,allowRecovery=false){
 if(saving){toast('Aguarde o salvamento atual.');return false;}
 if(!validBackup(next)){toast('Não foi possível salvar: existem dados inconsistentes.');return false;}
 if(demo){demo=next;render();if(msg)toast(msg);return true;}
 if(storageIssue&&!allowRecovery){toast('Recarregue seus dados antes de salvar.');return false;}
 saving=true;document.body.classList.add('saving');
 try{
  const result=await window.Account.api('data','PUT',{data:next,revision:cloudRevision});
  cloudPrevious=saved;cloudRevision=result.revision;saved=next;loadedRaw=JSON.stringify(next);storageIssue='';tabConflict=false;
  render();if(msg)toast(msg);return true;
 }catch(e){if(e.status===409){tabConflict=true;renderSafety();}toast(e.message);return false;}
 finally{saving=false;document.body.classList.remove('saving');}
}
function renderSafety(){const el=$('#safetyBanner');if(!el)return;el.hidden=!storageIssue&&!tabConflict;el.innerHTML=storageIssue?`${esc(storageIssue)} <a href="#perfil">Abrir recuperação</a>`: 'Os dados mudaram em outra aba. Recarregue antes de editar. <button data-action="reload">Recarregar dados</button>';}
function mutate(fn,msg){const next=JSON.parse(JSON.stringify(state()));fn(next);return commit(next,msg);}
function toast(msg){clearTimeout(toastTimer);$('#toast').textContent=msg;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,6500);}
function bounds(){const d=new Date(),today=dateKey(d);if(period==='today')return[today,today];if(period==='week'){d.setDate(d.getDate()-((d.getDay()+6)%7));return[dateKey(d),today];}if(period==='month')return[`${today.slice(0,7)}-01`,today];if(period==='custom')return[$('#from').value||today,$('#to').value||today];return['0000-01-01','9999-12-31'];}
function inRange(e,b=bounds()){return e.date>=b[0]&&e.date<=b[1];}
function totals(entries){const income=entries.filter(e=>e.type==='income'),expense=entries.filter(e=>e.type==='expense'),sum=(a,k)=>round(a.reduce((n,e)=>n+e[k],0));return{income:sum(income,'amount'),expense:sum(expense,'amount'),net:round(sum(income,'amount')-sum(expense,'amount')),km:sum(income,'km'),hours:sum(income,'hours'),count:sum(income,'count')};}
const selected=()=>state().entries.filter(e=>inRange(e));
function empty(title,body){return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:48px;height:48px;color:var(--muted);margin-bottom:16px;opacity:0.3"><path d="M21 8v13H3V8M1 3h22v5H1z M10 12h4"/></svg><strong>${title}</strong><p>${body}</p></div>`;}
function card(label,value,note,feature=false){return `<div class="card ${feature?'feature':''}"><div class="label">${label}</div><div class="value">${value}</div><small>${note}</small></div>`;}
function cards(t){
  const isPositive = t.net >= 0;
  const badgeClass = isPositive ? 'profit' : 'loss';
  const badgeText = isPositive ? '▲ Lucro Líquido' : '▼ Saldo Negativo';
  const valFormatted = secretMoney(t.net);
  const incFormatted = secretMoney(t.income);
  const expFormatted = secretMoney(t.expense);
  const rendKmFormatted = t.km ? (hideValues ? '•••••' : money(t.net/t.km)+'/km') : '—';
  const rendHourFormatted = t.hours ? (hideValues ? '•••••' : money(t.net/t.hours)+'/h') : '—';

  return `
    <div class="hero-balance-card ${isPositive?'is-profit':'is-loss'}">
      <div class="hero-balance-header">
        <div class="hero-header-left">
          <span class="hero-badge ${badgeClass}">${badgeText}</span>
          <span class="hero-label">SALDO DO PERÍODO</span>
        </div>
        <button type="button" class="btn-privacy-eye" onclick="window.togglePrivacy()" title="${hideValues?'Mostrar valores':'Ocultar valores (Modo Privacidade)'}" aria-label="Alternar privacidade">
          ${hideValues ? `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
            <span>Oculto</span>
          ` : `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Privacidade</span>
          `}
        </button>
      </div>

      <div class="hero-balance-main">
        <div class="hero-balance-value ${isPositive?'positive':'negative'}">
          ${valFormatted}
        </div>
        <p class="hero-balance-desc">Ganhos menos despesas pagas</p>
      </div>

      <div class="hero-balance-grid">
        <div class="hero-subcard income">
          <div class="hero-sub-label">🟢 Ganhos Brutos</div>
          <div class="hero-sub-val">${incFormatted}</div>
          <small class="hero-sub-note">${number(t.count)} corridas registradas</small>
        </div>
        <div class="hero-subcard expense">
          <div class="hero-sub-label">🔴 Despesas Pagas</div>
          <div class="hero-sub-val">${expFormatted}</div>
          <small class="hero-sub-note">Gastos operacionais</small>
        </div>
        <div class="hero-subcard efficiency">
          <div class="hero-sub-label">🚗 Por Km Rodado</div>
          <div class="hero-sub-val">${rendKmFormatted}</div>
          <small class="hero-sub-note">${t.km ? number(t.km)+' km rodados' : 'Sem km registrado'}</small>
        </div>
        <div class="hero-subcard efficiency" style="border-color:#1e4963;">
          <div class="hero-sub-label">⏱️ Por Hora Líquida</div>
          <div class="hero-sub-val" style="color:#38bdf8;">${rendHourFormatted}</div>
          <small class="hero-sub-note">${t.hours ? number(t.hours)+' h trabalhadas' : 'Sem horas anotadas'}</small>
        </div>
      </div>
    </div>
  `;
}
function appBadge(app, isDaily=false){
  if(isDaily) return '<span class="badge-app" style="background:#1e293b;color:#38bdf8;border:1px solid #0284c7;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:4px;">📊 Fechamento Geral</span>';
  if(!app) return '<span class="badge-app" style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">🚗 Corrida</span>';
  const a=String(app).toLowerCase().trim();
  if(a.includes('uber')) return '<span class="badge-app badge-uber" style="background:#000000;color:#ffffff;border:1px solid #475569;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><span style="font-size:10px;line-height:1;background:#fff;color:#000;padding:1px 3px;border-radius:2px;font-weight:900;">U</span> Uber</span>';
  if(a.includes('99')) return '<span class="badge-app badge-99" style="background:#f59e0b;color:#000000;border:1px solid #d97706;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:900;display:inline-flex;align-items:center;gap:4px;">⚡ 99 Pop</span>';
  if(a.includes('indrive')||a.includes('drive')) return '<span class="badge-app badge-indrive" style="background:#059669;color:#ffffff;border:1px solid #10b981;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:4px;">🟢 inDrive</span>';
  if(a.includes('part')||a.includes('privado')) return '<span class="badge-app badge-part" style="background:#1e3a8a;color:#bfdbfe;border:1px solid #3b82f6;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:4px;">🚗 Particular</span>';
  return `<span class="badge-app" style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${esc(app)}</span>`;
}
function table(entries){if(!entries.length)return empty('Seu histórico começa aqui','Registre um ganho ou uma despesa para acompanhar a evolução.');return `<div class="table-wrap"><table class="transactions-table"><thead><tr><th>Data</th><th>Lançamento</th><th>Detalhes</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${[...entries].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<tr><td>${displayDate(e.date)}</td><td>${e.type==='income'?(e.mode==='daily'?appBadge('',true):appBadge(e.app)):`<span style="background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);padding:2px 7px;border-radius:5px;font-size:11px;font-weight:700;">${esc(e.category)}</span>`}${e.description?`<br><small class="muted">${esc(e.description)}</small>`:''}</td><td>${e.type==='income'?`${number(e.count)} corridas · ${number(e.km)} km<br><small>${number(e.hours)} h registradas</small>`:'<span class="tag">Despesa</span>'}</td><td class="${e.type==='income'?'positive':'negative'}">${e.type==='income'?'+':'−'} ${money(e.amount)}</td><td><button data-edit="${esc(e.id)}" aria-label="Editar lançamento de ${displayDate(e.date)}">Editar</button> <button data-delete="${esc(e.id)}" class="ghost danger" aria-label="Excluir lançamento de ${displayDate(e.date)}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`;}
function trendData(report=false){
 let start,end;const b=bounds();if(!report){end=b[1]==='9999-12-31'?dateKey():b[1];const d=new Date(end+'T12:00:00');d.setDate(d.getDate()-6);start=dateKey(d);}else{const dates=selected().map(e=>e.date).sort();start=b[0]==='0000-01-01'?(dates[0]||dateKey()):b[0];end=b[1]==='9999-12-31'?(dates.at(-1)||dateKey()):b[1];}
 const n=Math.round((new Date(end+'T12:00:00')-new Date(start+'T12:00:00'))/86400000)+1;
 const monthly=n>45,yearly=n>730,map=new Map();const d=new Date(start+'T12:00:00'),finish=new Date(end+'T12:00:00');if(yearly)d.setMonth(0,1);else if(monthly)d.setDate(1);
 for(let i=0;d<=finish&&i<1200;i++){const key=dateKey(d).slice(0,yearly?4:monthly?7:10);map.set(key,{key,label:yearly?key:monthly?d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}):d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}),income:0,expense:0,net:0});if(yearly)d.setFullYear(d.getFullYear()+1);else if(monthly)d.setMonth(d.getMonth()+1);else d.setDate(d.getDate()+1);}
 for(const e of state().entries){if(e.date<start||e.date>end)continue;const key=e.date.slice(0,yearly?4:monthly?7:10),v=map.get(key);if(v){v[e.type==='income'?'income':'expense']+=e.amount;}}
 const points=[...map.values()].map(p=>({...p,income:round(p.income),expense:round(p.expense),net:round(p.income-p.expense)}));return {points,start,end,group:yearly?'ano':monthly?'mês':'dia'};
}
function chart(report=false){
  const {points,start,end,group}=trendData(report);const hasData=points.some(p=>p.income||p.expense);
  if(!hasData) return '<p class="chart-empty" style="margin:20px 0">Ainda sem lançamentos. Registre seus dados ou use <button class="text-button" data-action="demo">Ver demonstração</button>.</p>';
  const id = 'chart_' + uid();
  chartInitializers.push(() => {
    const ctx = document.getElementById(id);
    if(!ctx) return;
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: points.map(p=>p.label),
        datasets: [
          {label:'Ganhos', data: points.map(p=>p.income), borderColor: '#43a6ff', backgroundColor: 'rgba(67, 166, 255, 0.12)', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: '#43a6ff'},
          {label:'Despesas', data: points.map(p=>p.expense), borderColor: '#ffb46b', borderDash: [6, 4], tension: 0.4, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: '#ffb46b'},
          {label:'Saldo', data: points.map(p=>p.net), borderColor: '#34d6ac', backgroundColor: 'rgba(52, 214, 172, 0.18)', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: '#34d6ac'}
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(10, 23, 37, 0.95)', titleColor: '#fff', bodyColor: '#9eb4c8', borderColor: '#22394d', borderWidth: 1, padding: 12, displayColors: true, callbacks: { label: (ctx) => ' ' + ctx.dataset.label + ': ' + money(ctx.raw) } } },
        scales: {
          x: { grid: { display: false, drawBorder: false }, ticks: { color: '#9eb4c8', maxTicksLimit: 7 } },
          y: { grid: { color: '#22394d', drawBorder: false }, border: { display: false }, ticks: { color: '#9eb4c8', callback: v => number(v) } }
        }
      }
    });
  });
  return `<div class="legend"><span><i style="background:#43a6ff"></i>Ganhos</span><span><i style="background:#ffb46b"></i>Despesas</span><span><i style="background:#34d6ac"></i>Saldo</span></div><div style="height:250px;width:100%;position:relative;margin-top:10px;"><canvas id="${id}"></canvas></div><details class="chart-details"><summary>Ver valores do gráfico por ${group}</summary><div class="table-wrap"><table class="chart-table"><thead><tr><th>Período</th><th>Ganhos</th><th>Despesas</th><th>Saldo</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.label}</td><td>${money(p.income)}</td><td>${money(p.expense)}</td><td>${money(p.net)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function donut(entries=selected()){
  const by=new Map();for(const e of entries.filter(e=>e.type==='expense'))by.set(e.category,round((by.get(e.category)||0)+e.amount));
  const items=[...by.entries()].sort((a,b)=>b[1]-a[1]),total=round(items.reduce((s,e)=>s+e[1],0));
  const colors=['#ffb46b','#43a6ff','#b49aff','#34d6ac','#fa819d','#e4d071','#69cddd','#cf9c7f','#a9b7c5','#8796fc','#bfce8b'];
  if(items.length===0) return '<div class="donut-layout" style="display:block;text-align:center;padding:20px 0;"><p class="muted">O gráfico se preenche com as despesas registradas. Nenhum valor fictício é mostrado nos seus dados.</p></div>';
  const id = 'donut_' + uid();
  chartInitializers.push(() => {
    const ctx = document.getElementById(id);
    if(!ctx) return;
    new Chart(ctx, {
      type: 'doughnut',
      data: { labels: items.map(i=>i[0]), datasets: [{ data: items.map(i=>i[1]), backgroundColor: colors, borderWidth: 2, borderColor: '#102235', hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '76%', plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(10, 23, 37, 0.95)', titleColor: '#fff', bodyColor: '#9eb4c8', borderColor: '#22394d', borderWidth: 1, padding: 12, callbacks: { label: (ctx) => ' ' + ctx.label + ': ' + money(ctx.raw) } } } }
    });
  });
  return `<div class="donut-layout"><div style="position:relative;width:220px;height:220px;"><canvas id="${id}"></canvas><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;"><span style="font-size:11px;color:var(--muted);letter-spacing:1px;font-weight:700;margin-top:4px">TOTAL GASTO</span><span style="font-size:19px;font-weight:800;color:var(--text)">${money(total)}</span></div></div><div class="donut-legend">${items.map(([k,v],i)=>`<div class="list-row"><span><i style="background:${colors[i%colors.length]}"></i>${esc(k)}</span><span><strong>${money(v)}</strong><small>${total>0?number(v/total*100):0}%</small></span></div>`).join('')}</div></div>`;
}
function goalPanel(title,actual,target,note){
  const reached = target > 0 && actual >= target;
  const pct = target > 0 ? Math.max(0, actual / target * 100) : 100;
  return `
    <div class="goal-card-wrap ${reached ? 'goal-reached-glow' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <h2 style="margin:0;">${title}</h2>
        ${reached ? `<span style="background:linear-gradient(135deg, #10b981, #059669);color:#ffffff;font-size:11px;font-weight:900;padding:4px 10px;border-radius:20px;letter-spacing:0.5px;box-shadow:0 0 14px rgba(16,185,129,0.5);display:inline-flex;align-items:center;gap:4px;">🎯 META BATIDA!</span>` : ''}
      </div>
      <p class="muted" style="margin-bottom:6px;">${money(actual)} de ${money(target)}</p>
      <div class="metric" style="${reached ? 'color:#34d6ac;text-shadow:0 0 12px rgba(52,214,172,0.45);' : ''}">${number(pct)}%</div>
      <progress max="100" value="${Math.min(100,pct)}" aria-label="${esc(title)}"></progress>
      <p style="margin-top:10px;">${reached ? '🎉 <strong>Sensacional! Você já superou sua meta diária de hoje!</strong>' : `Faltam <strong>${money(target-actual)}</strong> para bater o objetivo.`}</p>
      <small class="muted">${note}</small>
    </div>
  `;
}
function bestDayCard(){
  const incomes = (state().entries || []).filter(e => e.type === 'income' && e.amount > 0);
  if (!incomes.length) return '';

  const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  
  const dateTotals = new Map();
  incomes.forEach(e => {
    if (!e.date) return;
    const current = dateTotals.get(e.date) || { sum: 0, dayOfWeek: (new Date(e.date + 'T12:00:00')).getDay() };
    current.sum += Number(e.amount || 0);
    dateTotals.set(e.date, current);
  });

  const promoHtml = `
    <div class="smart-economy-card promo" style="margin-bottom:18px;">
      <div class="economy-icon-wrap">📅</div>
      <div class="economy-content">
        <div class="economy-badge">📊 INTELIGÊNCIA OPERACIONAL</div>
        <div class="economy-headline">O Capitalex está mapeando seu <strong>Melhor Dia</strong> e sua <strong>Folga Inteligente</strong>.</div>
        <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">
          Continue registrando suas corridas. Conforme acumular dias de trabalho, o sistema identifica automaticamente qual dia mais lucra e qual é o ideal para folgar sem perder faturamento!
        </p>
      </div>
    </div>
  `;

  if (dateTotals.size < 3) return promoHtml;

  const dayStats = Array(7).fill(null).map((_, i) => ({ day: i, name: dayNames[i], totalSum: 0, daysCount: 0 }));
  dateTotals.forEach(d => {
    if (d.dayOfWeek >= 0 && d.dayOfWeek <= 6) {
      dayStats[d.dayOfWeek].totalSum += d.sum;
      dayStats[d.dayOfWeek].daysCount += 1;
    }
  });

  const workedDays = dayStats.filter(d => d.daysCount > 0).map(d => ({
    ...d,
    avg: round(d.totalSum / d.daysCount)
  }));

  if (workedDays.length < 2) return promoHtml;

  workedDays.sort((a, b) => b.avg - a.avg);
  const best = workedDays[0];
  const weakest = workedDays[workedDays.length - 1];

  const bestValFormatted = hideValues ? '•••••' : money(best.avg) + '/dia';
  const weakValFormatted = hideValues ? '•••••' : money(weakest.avg) + '/dia';

  return `
    <div class="smart-economy-card" style="background:linear-gradient(135deg,rgba(16,42,65,0.85),rgba(9,26,45,0.95));border:1px solid #1e4d75;box-shadow:0 8px 24px rgba(0,0,0,0.25);margin-bottom:18px;">
      <div class="economy-icon-wrap" style="background:linear-gradient(135deg,rgba(52,214,172,0.2),rgba(56,189,248,0.2));border-color:#34d6ac;color:#34d6ac;font-size:24px;">⭐</div>
      <div class="economy-content">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
          <div class="economy-badge" style="background:rgba(52,214,172,0.15);color:#34d6ac;border-color:rgba(52,214,172,0.35);">
            🧠 INTELIGÊNCIA CAPITALEX • SEU MELHOR DIA
          </div>
          <span style="font-size:12px;font-weight:700;color:#94a3b8;background:rgba(255,255,255,0.06);padding:3px 9px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);">
            ${dateTotals.size} dias analisados
          </span>
        </div>
        <div class="economy-headline" style="font-size:15px;line-height:1.45;color:#f1f5f9;">
          Seu dia mais lucrativo é <strong style="color:#34d6ac;font-weight:800;font-size:16px;">${best.name}</strong>, faturando em média <strong style="color:#38bdf8;">${bestValFormatted}</strong>!
        </div>
        <div style="margin-top:8px;padding:10px 12px;background:rgba(8,19,32,0.7);border-radius:10px;border-left:3px solid #ffb46b;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:16px;line-height:1.2;">💡</span>
          <p style="margin:0;font-size:13px;line-height:1.4;color:#cbd5e1;">
            <strong>Dica Estratégica:</strong> Seu dia de menor faturamento histórico é <strong>${weakest.name}</strong> (${weakValFormatted}). Sugerido para sua <strong>folga semanal</strong> ou manutenção preventiva, poupando combustível e preservando o carro nos dias de demanda baixa!
          </p>
        </div>
      </div>
    </div>
  `;
}
function economyCard(t){
  const entries=selected();
  const fuelExpenses=entries
    .filter(e=>e.type==='expense'&&(e.category==='Combustível'||(e.description&&e.description.toLowerCase().includes('combust'))))
    .reduce((s,e)=>s+e.amount,0);
  const totalExpense=t.expense;
  let estimatedSavings=0,hasExpenses=false;
  if(fuelExpenses>0){
    estimatedSavings=round(fuelExpenses*0.14);
    hasExpenses=true;
  }else if(totalExpense>0){
    estimatedSavings=round(totalExpense*0.12);
    hasExpenses=true;
  }
  const monthlyCost=25.95;
  const timesPaid=estimatedSavings>0?(estimatedSavings/monthlyCost).toFixed(1).replace('.',','):'0';
  if(!hasExpenses||estimatedSavings<15){
    return `<div class="smart-economy-card promo"><div class="economy-icon-wrap">💡</div><div class="economy-content"><div class="economy-badge">PLACAR DE ECONOMIA</div><h3>Monitore seus abastecimentos</h3><p>Motoristas organizados cortam em média <strong>14% em custos de combustível</strong> ao evitar rodar vazios. Lance seus abastecimentos para ver sua economia real!</p></div></div>`;
  }
  const savingsFormatted=hideValues?'•••••':money(estimatedSavings);
  return `<div class="smart-economy-card"><div class="economy-icon-wrap">⚡</div><div class="economy-content"><div class="economy-badge">💡 ECONOMIA INTELIGENTE IDENTIFICADA</div><div class="economy-headline">O Capitalex já ajudou você a identificar <strong class="economy-amount">${savingsFormatted}</strong> em economia de combustível e custos evitados no período.</div><div class="economy-footer"><span class="economy-pill">🔥 Já pagou sua assinatura mais de <strong>${timesPaid}x</strong></span><span class="economy-subtext">Cálculo baseado na redução de km rodado vazio e controle de consumo.</span></div></div></div>`;
}
 function dashboard(){
  const t=totals(selected()),today=totals(state().entries.filter(e=>e.date===dateKey())),reserve=round(t.km*state().reservePerKm);
  const p=state().profile;let alertHtml='';
  if(p.serviceAt&&p.odometer){
    const left=p.serviceAt-p.odometer;
    if(left<=0) alertHtml=`<div class="card feature" style="background:linear-gradient(135deg,#5e1c29,#380e15);border-color:#a1263c;color:#ffb1a7;margin-bottom:16px;"><strong>🚨 Troca de Óleo / Revisão Atrasada!</strong><p style="margin:4px 0 0;font-size:14px;color:#fbb">Você já passou ${number(-left)} km da meta. Agende a manutenção na aba Veículo!</p></div>`;
    else if(left<=500) alertHtml=`<div class="card feature" style="background:linear-gradient(135deg,#523512,#2b1a07);border-color:#8a5a1f;color:#ffb46b;margin-bottom:16px;"><strong>⚠️ Atenção à Manutenção!</strong><p style="margin:4px 0 0;font-size:14px;color:#fcdcb8">Faltam apenas ${number(left)} km para a sua próxima revisão.</p></div>`;
  }
  let reminderBanner = '';
  if (window.CapitalexNotifier && window.CapitalexNotifier.isSupported() && window.CapitalexNotifier.getPermission() === 'default' && !localStorage.getItem('capitalex_reminders_dismissed')) {
    reminderBanner = `<div class="card feature reminder-banner" style="background:linear-gradient(135deg,rgba(40,80,120,0.5),rgba(20,40,70,0.7));border:1px solid #3875a8;color:#d5e8ff;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:14px 18px;border-radius:12px;"><div><strong style="display:flex;align-items:center;gap:6px;font-size:15px;color:#fff;">🔔 Ativar Lembretes Diários</strong><p style="margin:4px 0 0;font-size:13px;color:#bcd2ea">Receba bênçãos de bom dia e lembretes para não esquecer de anotar corridas (07:00, 12:30, 17:30 e 21:30).</p></div><div style="display:flex;gap:8px;align-items:center;"><button class="primary" data-action="enable-reminders" style="white-space:nowrap;padding:8px 16px;font-size:13px;">Ativar Agora</button><button class="ghost" data-action="dismiss-reminders" style="padding:8px 12px;font-size:13px;" title="Depois">✕</button></div></div>`;
  }
  const ipvaTotalDash = (state().funds||[]).filter(f=>f&&f.name&&(f.name==='IPVA e Seguro'||f.name.toLowerCase().includes('ipva')||f.name.toLowerCase().includes('seguro'))).reduce((a,f)=>a+Number(f.amount||0),0);
  const targetIpvaDash = Number(localStorage.getItem('cap_ipva_goal'))||Number(state().profile.ipvaGoal)||2400;
  const pctIpvaDash = Math.min(100, Math.round((ipvaTotalDash/targetIpvaDash)*100));
  return `${alertHtml}${reminderBanner}${cards(t)}${economyCard(t)}${bestDayCard()}<div class="split"><section class="panel"><div class="panel-head"><div><h2>Ritmo da semana</h2><p>7 dias até a data final do período • valores em R$</p></div><span class="tag">7 DIAS</span></div>${chart()}</section><section class="panel">${goalPanel('Sua meta de hoje',today.net,state().goals.daily,'Meta sobre o saldo, antes das reservas estimadas.')}<div class="actions" style="margin-top:20px"><button class="primary" data-action="income">🚗 Nova Corrida</button><button class="ghost" data-action="expense">⛽ Novo Gasto</button><button class="ghost" data-action="daily">⚡ Fechar Dia</button><button class="ghost" onclick="window.gerarCardWhatsApp()" style="border-color:#24534f;color:#34d6ac;font-weight:700;"><span style="font-size:15px;">📸</span> Card do Dia</button></div></section></div><section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Para onde foi o dinheiro</h2><p>Despesas do período, por categoria</p></div><a href="#gastos" class="positive">Ver despesas</a></div>${donut()}</section><div class="split"><section class="panel"><div class="panel-head"><h2>Últimos lançamentos</h2><a href="#corridas" class="positive">Ver ganhos</a></div>${table([...selected()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5))}</section><section class="panel"><h2>Olhar para o próximo mês</h2><p class="muted">Provisão estimada para o desgaste do carro.</p><div class="list-row"><span>Reserva sugerida</span><strong>${money(reserve)}</strong></div><div class="list-row"><span>Saldo após provisão</span><strong class="positive">${money(t.net-reserve)}</strong></div><div class="list-row" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);"><span>🛡️ IPVA & Seguro</span><strong><a href="#investimentos" style="color:var(--green);text-decoration:none;font-weight:750;">${pctIpvaDash}% blindado (${money(ipvaTotalDash)}) ➔</a></strong></div><p class="notice">Estimativa de ${money(state().reservePerKm)} por km. Não movimenta dinheiro e não é uma despesa paga. Ajuste em Veículo.</p></section></div>`;
 }
function gains(){return `<section class="panel"><div class="panel-head"><div><h2>Seu trabalho registrado</h2><p>Escolha corridas individuais ou um fechamento completo por dia.</p></div><div class="actions"><button class="primary" data-action="daily">Fechar dia</button><button class="ghost" onclick="window.gerarCardWhatsApp()" style="border-color:#24534f;color:#34d6ac;font-weight:700;">📸 Card do Dia</button></div></div><p class="notice">O fechamento soma todos os aplicativos. Para evitar duplicidade, um dia com corridas individuais não aceita fechamento até que esses registros sejam removidos.</p>${table(selected().filter(e=>e.type==='income'))}</section>`;}
function expenses(){return `<div class="split"><section class="panel"><div class="panel-head"><h2>Despesas do período</h2><button data-action="expense" class="primary">+ Gasto</button></div>${table(selected().filter(e=>e.type==='expense'))}</section><section class="panel"><h2>Despesas por categoria</h2><p class="muted">Valores e participação no período selecionado.</p>${donut()}</section></div>`;}
function waterfallChart(entries=selected()){
  const income=entries.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0);
  if(!income)return empty('Faltam ganhos para a cascata','Registre seus ganhos para ver como as despesas afetam o resultado.');
  const exps=new Map();entries.filter(e=>e.type==='expense').forEach(e=>exps.set(e.category,(exps.get(e.category)||0)+e.amount));
  const items=[...exps.entries()].sort((a,b)=>b[1]-a[1]);
  const labels=['Ganho Bruto'],data=[[0,income]],bgColors=['#43a6ff'];
  let currentTop=income;
  for(const [cat,val] of items){if(val<=0)continue;labels.push(cat);data.push([currentTop-val,currentTop]);bgColors.push('#ffb46b');currentTop-=val;}
  labels.push('Lucro Líquido');data.push([0,currentTop]);bgColors.push(currentTop>=0?'#34d6ac':'#ffb1a7');
  const id='waterfall_'+uid();
  chartInitializers.push(()=>{
    const ctx=document.getElementById(id);if(!ctx)return;
    new Chart(ctx,{
      type:'bar',
      data:{labels:labels,datasets:[{data:data,backgroundColor:bgColors,borderWidth:0,borderRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(10, 23, 37, 0.95)',titleColor:'#fff',bodyColor:'#9eb4c8',borderColor:'#22394d',borderWidth:1,padding:12,callbacks:{label:ctx=>' '+money(Math.abs(ctx.raw[1]-ctx.raw[0]))}}},scales:{x:{grid:{display:false,drawBorder:false},ticks:{color:'#9eb4c8'}},y:{grid:{color:'#22394d',drawBorder:false},border:{display:false},ticks:{color:'#9eb4c8',callback:v=>number(v)}}}}
    });
  });
  return `<div style="height:280px;width:100%;position:relative;margin-top:10px;"><canvas id="${id}"></canvas></div><p class="notice" style="margin-top:16px;text-align:center;">O gráfico mostra como cada despesa reduz o Ganho Bruto até sobrar o Lucro Líquido final.</p>`;
}
function vehicle(){
  const p=state().profile, left=p.serviceAt-p.odometer;
  const isRent = p.vehicleType === 'rent';

  // Dados de Carro Alugado
  const rentWeekly = Number(p.rentWeekly) || 650;
  const rentWorkDays = Number(p.rentWorkDays) || 6;
  const rentDaily = round(rentWeekly / Math.max(1, rentWorkDays));
  const rentDay = p.rentDay || 'Sexta';
  const rentKmLimit = Number(p.rentKmLimit) || 1250;

  // Cálculo de KM rodados na semana atual (segunda-feira até hoje)
  const dNow = new Date();
  const dMon = new Date(dNow);
  dMon.setDate(dMon.getDate() - ((dMon.getDay() + 6) % 7));
  const monKey = dateKey(dMon);
  const weekIncomes = state().entries.filter(e => e.type === 'income' && e.date >= monKey && e.date <= dateKey());
  const weekKm = round(weekIncomes.reduce((s, e) => s + (Number(e.km) || 0), 0));
  const kmLimitLeft = rentKmLimit > 0 ? (rentKmLimit - weekKm) : 0;
  const kmPct = rentKmLimit > 0 ? Math.min(100, Math.round((weekKm / rentKmLimit) * 100)) : 0;

  // Dados de Carro Próprio & Manutenções Preventivas
  const ipvaStr = p.ipva ? (new Date(p.ipva) < new Date() ? 'Vencido' : displayDate(p.ipva)) : 'Não definido';
  const segStr = p.seguro ? (new Date(p.seguro) < new Date() ? 'Vencido' : displayDate(p.seguro)) : 'Não definido';

  const oilTarget = Number(p.oilChangeKm) || (p.odometer ? p.odometer + 10000 : 10000);
  const oilLeft = oilTarget - p.odometer;
  const oilPct = Math.max(0, Math.min(100, Math.round((1 - (Math.max(0, oilLeft) / 10000)) * 100)));

  const brakesTarget = Number(p.brakesKm) || (p.odometer ? p.odometer + 30000 : 30000);
  const brakesLeft = brakesTarget - p.odometer;
  const brakesPct = Math.max(0, Math.min(100, Math.round((1 - (Math.max(0, brakesLeft) / 30000)) * 100)));

  const tiresTarget = Number(p.tiresKm) || (p.odometer ? p.odometer + 10000 : 10000);
  const tiresLeft = tiresTarget - p.odometer;
  const tiresPct = Math.max(0, Math.min(100, Math.round((1 - (Math.max(0, tiresLeft) / 10000)) * 100)));

  const heroRentHtml = isRent ? `
    <section class="panel" style="background:linear-gradient(135deg,rgba(67,166,255,0.08) 0%,rgba(10,23,38,0.95) 100%);border:1.5px solid rgba(67,166,255,0.4);border-radius:20px;padding:22px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <span class="tag" style="background:rgba(67,166,255,0.2);color:#38bdf8;font-weight:800;font-size:11px;letter-spacing:1px;margin-bottom:6px;display:inline-block;">VEÍCULO ALUGADO • LOCADORA</span>
          <h2 style="font-size:22px;margin:2px 0;color:var(--text);font-weight:800;">Controle do Aluguel & Franquia</h2>
          <p class="muted" style="margin:4px 0 0;font-size:13.5px;">Custo fixo semanal e monitoramento do limite de km para não pagar multa.</p>
        </div>
        <button class="primary" data-action="vehicle" style="white-space:nowrap;">⚙️ Ajustar Valores</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
        <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:14px;border:1px solid var(--line);">
          <small style="color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.5px;display:block;">Aluguel Semanal</small>
          <strong style="font-size:22px;color:#38bdf8;font-family:'JetBrains Mono',monospace;">${money(rentWeekly)}</strong>
          <small style="color:var(--muted);display:block;margin-top:2px;">Cobrado toda ${rentDay}</small>
        </div>
        <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:14px;border:1px solid var(--line);">
          <small style="color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.5px;display:block;">Custo por Dia de Trabalho</small>
          <strong style="font-size:22px;color:var(--green);font-family:'JetBrains Mono',monospace;">${money(rentDaily)}</strong>
          <small style="color:var(--muted);display:block;margin-top:2px;">Baseado em ${rentWorkDays} dias/sem</small>
        </div>
        <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:14px;border:1px solid var(--line);">
          <small style="color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.5px;display:block;">KM Rodados na Semana</small>
          <strong style="font-size:22px;color:${kmLimitLeft<0?'#f87171':'var(--text)'};font-family:'JetBrains Mono',monospace;">${number(weekKm)} km</strong>
          <small style="color:var(--muted);display:block;margin-top:2px;">Franquia: ${rentKmLimit?number(rentKmLimit)+' km':'Livre'}</small>
        </div>
      </div>

      ${rentKmLimit > 0 ? `
        <div style="background:rgba(8,20,32,0.7);padding:14px 16px;border-radius:14px;border:1px solid #1f3a54;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span>Consumo da Franquia Semanal: <strong>${kmPct}%</strong></span>
            <span style="font-weight:700;color:${kmLimitLeft<=0?'#f87171':'#34d6ac'};">
              ${kmLimitLeft <= 0 ? '⚠️ Franquia semanal estourada!' : `Restam ${number(kmLimitLeft)} km até ${rentDay}`}
            </span>
          </div>
          <progress value="${kmPct}" max="100" style="height:12px;width:100%;border-radius:6px;"></progress>
        </div>
      ` : ''}
    </section>
  ` : '';

  const maintenanceHtml = !isRent ? `
    <section class="panel" style="margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
        <div>
          <h2>🛠️ Manutenções Preventivas por Hodômetro</h2>
          <p class="muted" style="margin:2px 0 0;font-size:13.5px;">Monitore o desgaste e saiba a hora exata da troca antes de danificar o motor.</p>
        </div>
        <button class="primary" data-action="vehicle">⚙️ Configurar Alvos</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
        <!-- Card Óleo -->
        <div style="background:rgba(8,20,32,0.8);border:1px solid ${oilLeft<=1000?'rgba(255,180,107,0.5)':'#1c3850'};border-radius:16px;padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:15px;color:var(--text);display:flex;align-items:center;gap:6px;">🟡 Troca de Óleo & Filtro</strong>
            <span class="tag" style="background:${oilLeft<=1000?'rgba(255,180,107,0.2)':'rgba(52,214,172,0.15)'};color:${oilLeft<=1000?'var(--orange)':'var(--green)'};font-size:10.5px;">
              ${oilLeft<=0?'VENCIDA!':oilLeft<=1000?'ATENÇÃO':'EM DIA'}
            </span>
          </div>
          <div style="font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;margin:6px 0;color:${oilLeft<=1000?'var(--orange)':'var(--green)'};">
            ${oilLeft<=0?'Trocar Já!':`${number(oilLeft)} km restantes`}
          </div>
          <small style="color:var(--muted);display:block;margin-bottom:10px;">Próxima troca aos: <strong>${number(oilTarget)} km</strong></small>
          <progress value="${oilPct}" max="100" style="height:8px;margin-bottom:12px;"></progress>
          <button type="button" class="ghost" onclick="window.resetMaintenance('oil')" style="width:100%;font-size:12px;padding:8px;border-color:#2a4d6e;">
            ✅ Feito! Renovar +10.000 km
          </button>
        </div>

        <!-- Card Pastilhas -->
        <div style="background:rgba(8,20,32,0.8);border:1px solid ${brakesLeft<=3000?'rgba(255,180,107,0.5)':'#1c3850'};border-radius:16px;padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:15px;color:var(--text);display:flex;align-items:center;gap:6px;">🛑 Pastilhas de Freio</strong>
            <span class="tag" style="background:${brakesLeft<=3000?'rgba(255,180,107,0.2)':'rgba(52,214,172,0.15)'};color:${brakesLeft<=3000?'var(--orange)':'var(--green)'};font-size:10.5px;">
              ${brakesLeft<=0?'VENCIDA!':brakesLeft<=3000?'ATENÇÃO':'EM DIA'}
            </span>
          </div>
          <div style="font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;margin:6px 0;color:${brakesLeft<=3000?'var(--orange)':'var(--green)'};">
            ${brakesLeft<=0?'Revisar Freio!':`${number(brakesLeft)} km restantes`}
          </div>
          <small style="color:var(--muted);display:block;margin-bottom:10px;">Próxima revisão aos: <strong>${number(brakesTarget)} km</strong></small>
          <progress value="${brakesPct}" max="100" style="height:8px;margin-bottom:12px;"></progress>
          <button type="button" class="ghost" onclick="window.resetMaintenance('brakes')" style="width:100%;font-size:12px;padding:8px;border-color:#2a4d6e;">
            ✅ Feito! Renovar +30.000 km
          </button>
        </div>

        <!-- Card Pneus -->
        <div style="background:rgba(8,20,32,0.8);border:1px solid ${tiresLeft<=1500?'rgba(255,180,107,0.5)':'#1c3850'};border-radius:16px;padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:15px;color:var(--text);display:flex;align-items:center;gap:6px;">🛞 Rodízio de Pneus</strong>
            <span class="tag" style="background:${tiresLeft<=1500?'rgba(255,180,107,0.2)':'rgba(52,214,172,0.15)'};color:${tiresLeft<=1500?'var(--orange)':'var(--green)'};font-size:10.5px;">
              ${tiresLeft<=0?'FAZER RODÍZIO':tiresLeft<=1500?'ATENÇÃO':'EM DIA'}
            </span>
          </div>
          <div style="font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;margin:6px 0;color:${tiresLeft<=1500?'var(--orange)':'var(--green)'};">
            ${tiresLeft<=0?'Rodízio Pendente':`${number(tiresLeft)} km restantes`}
          </div>
          <small style="color:var(--muted);display:block;margin-bottom:10px;">Próximo rodízio aos: <strong>${number(tiresTarget)} km</strong></small>
          <progress value="${tiresPct}" max="100" style="height:8px;margin-bottom:12px;"></progress>
          <button type="button" class="ghost" onclick="window.resetMaintenance('tires')" style="width:100%;font-size:12px;padding:8px;border-color:#2a4d6e;">
            ✅ Feito! Renovar +10.000 km
          </button>
        </div>
      </div>
    </section>
  ` : '';

  const summaryCards = isRent 
    ? `<div class="cards">
        ${card('Veículo',esc(p.vehicle)||'Não informado','Locadora')}
        ${card('Hodômetro',number(p.odometer)+' km','Atualização manual')}
        ${card('Diária do Aluguel',money(rentDaily),`${rentWorkDays} dias/semana`,true)}
        ${card('Vencimento Cobrança',`Toda ${rentDay}`,'Débito do aluguel')}
       </div>`
    : `<div class="cards">
        ${card('Veículo',esc(p.vehicle)||'Não informado','Carro Próprio')}
        ${card('Hodômetro',number(p.odometer)+' km','Atualização manual')}
        ${card('Próxima revisão',p.serviceAt?(left<=0?'Revisão pendente':number(left)+' km'):'Não definida',p.serviceAt?'Alvo: '+number(p.serviceAt)+' km':'Defina o alvo',true)}
        ${card('Vencimento IPVA',ipvaStr,'Imposto anual')}
        ${card('Vencimento Seguro',segStr,'Proteção do veículo')}
       </div>`;

  return `
    ${summaryCards}
    ${heroRentHtml}
    ${maintenanceHtml}
    <section class="panel">
      <h2>Planejamento do veículo</h2>
      <p class="muted">Atualize a quilometragem e mantenha seus registros preventivos em dia.</p>
      <div class="actions">
        <button data-action="vehicle" class="primary">Editar veículo</button>
        <button data-action="expense">Registrar manutenção</button>
        <a href="#calculadora" class="ghost" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;color:#34d6ac;border-color:#24534f;font-weight:700;">⛽ Comparador na Bomba</a>
      </div>
      <p class="notice">
        ${isRent 
          ? `Veículo alugado: custo fixo de ${money(rentDaily)}/dia de trabalho. Mantenha os lançamentos de combustível e refeição para saber seu lucro real no bolso.`
          : `Reserva atual: ${money(state().reservePerKm)}/km. A provisão mecânica é um planejamento para evitar surpresas na oficina.`}
      </p>
      <h3>Manutenções registradas no período</h3>
      ${table(selected().filter(e=>e.type==='expense'&&e.category==='Manutenção'))}
    </section>
  `;
}
function funds(){
  const s=state();
  const allFunds = s.funds || [];
  const ipvaRes=allFunds.filter(f=>f&&f.name&&(f.name==='IPVA e Seguro'||f.name.toLowerCase().includes('ipva')||f.name.toLowerCase().includes('seguro'))).reduce((a,f)=>a+Number(f.amount||0),0);
  const eRes=allFunds.filter(f=>f&&f.name==='Reserva de emergência').reduce((a,f)=>a+Number(f.amount||0),0);
  const fRes=allFunds.filter(f=>f&&f.name==='Férias e 13º').reduce((a,f)=>a+Number(f.amount||0),0);
  const total=round(allFunds.reduce((a,f)=>a+Number(f?.amount||0),0));
  const outros=Math.max(0,round(total-ipvaRes-eRes-fRes));
  const targetIpva=Number(localStorage.getItem('cap_ipva_goal'))||Number(s.profile.ipvaGoal)||2400;
  const pctIpva=Math.min(100,Math.round((ipvaRes/targetIpva)*100));
  const offset=157-(157*Math.min(100,pctIpva)/100);

  const heroCard=`
    <section class="panel ipva-blindada-hero">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px;">
        <div style="max-width:540px;">
          <span class="tag" style="background:rgba(52,214,172,0.18);color:var(--green);font-weight:800;font-size:11px;letter-spacing:1px;margin-bottom:8px;display:inline-block;">DÉBITO AUTOMÁTICO VIRTUAL</span>
          <h2 style="font-size:22px;margin:4px 0 6px;color:var(--text);font-weight:800;display:flex;align-items:center;gap:8px;">
            🛡️ Caixinha Blindada do IPVA & Seguro
          </h2>
          <p class="muted" style="margin:0;font-size:13.5px;line-height:1.5;">
            Chegue em janeiro sem aperto e sem pagar juros de 15% no cartão. Destine 10% a cada fechamento diário e blinde seus impostos.
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="primary" data-action="fund" style="white-space:nowrap;padding:10px 16px;">+ Guardar Dinheiro</button>
          <button class="ghost" onclick="window.configIpvaGoal()" style="white-space:nowrap;padding:10px 14px;font-size:13px;" title="Clique para alterar a meta anual">⚙️ Meta: ${money(targetIpva)}</button>
        </div>
      </div>

      <div class="ipva-hero-grid">
        <!-- SVG Velocímetro -->
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;width:180px;">
          <svg viewBox="0 0 120 70" style="width:180px;height:105px;overflow:visible;">
            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="11" stroke-linecap="round" />
            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="url(#ipvaGaugeGrad)" stroke-width="11" stroke-linecap="round"
              stroke-dasharray="157" stroke-dashoffset="${offset.toFixed(1)}" style="transition: stroke-dashoffset 0.8s ease;" />
            <defs>
              <linearGradient id="ipvaGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#38bdf8" />
                <stop offset="100%" stop-color="#34d6ac" />
              </linearGradient>
            </defs>
          </svg>
          <div style="position:absolute;bottom:12px;text-align:center;">
            <span style="font-size:26px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--green);line-height:1;display:block;">
              ${pctIpva}%
            </span>
            <span style="font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1px;text-transform:uppercase;">
              GARANTIDO
            </span>
          </div>
        </div>

        <!-- Estatísticas da Proteção -->
        <div style="width:100%;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:14px;">
            <div style="background:rgba(255,255,255,0.03);padding:12px 14px;border-radius:12px;border:1px solid var(--line);">
              <small style="color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.5px;display:block;">Blindado no Cofre</small>
              <strong style="font-size:20px;color:var(--green);font-family:'JetBrains Mono',monospace;">${secretMoney(ipvaRes)}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.03);padding:12px 14px;border-radius:12px;border:1px solid var(--line);">
              <small style="color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.5px;display:block;">Meta Anual Estimada</small>
              <strong style="font-size:20px;color:var(--text);font-family:'JetBrains Mono',monospace;">${money(targetIpva)}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.03);padding:12px 14px;border-radius:12px;border:1px solid var(--line);">
              <small style="color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.5px;display:block;">Falta Guardar</small>
              <strong style="font-size:20px;color:${targetIpva-ipvaRes<=0?'var(--green)':'#f87171'};font-family:'JetBrains Mono',monospace;">
                ${targetIpva-ipvaRes<=0?'Quitado! 🏆':secretMoney(targetIpva-ipvaRes)}
              </strong>
            </div>
          </div>

          <div style="background:rgba(52,214,172,0.08);border:1px solid rgba(52,214,172,0.25);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--text);">
            ${pctIpva>=100 
              ? '🔥 <strong>IPVA e Seguro 100% blindados!</strong> Seu início de ano está garantido sem dívidas nem aperto.'
              : `🛡️ <strong>${pctIpva}% do seu IPVA e Seguro garantido!</strong> Cada fechamento diário com débito virtual de 10% aproxima você da meta.`}
          </div>
        </div>
      </div>
    </section>
  `;

  return `
    ${heroCard}
    <div class="settings-grid">
      <section class="panel">${goalPanel('🛡️ Reserva de Emergência',eRes,s.goals.reserve,'Para imprevistos mecânicos e dias parados.')}</section>
      <section class="panel">${goalPanel('🏖️ Férias e 13º',fRes,s.goals.reserve>0?s.goals.reserve/2:0,'O seu descanso merecido.')}</section>
      <section class="panel">${goalPanel('📦 Outras Caixinhas',outros,0,'Pneus novos, acessórios e extras.')}</section>
    </div>
    <section class="panel" style="margin-top:20px">
      <h2>Extrato das Caixinhas</h2>
      <p class="muted">Dinheiro separado para os seus objetivos e proteção anual.</p>
      ${s.funds.length?`<div class="table-wrap"><table class="funds-table"><thead><tr><th>Data / Caixinha</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${[...s.funds].reverse().map(f=>`<tr><td>${displayDate(f.date)}<br><strong>${esc(f.name)}</strong>${(f.name==='IPVA e Seguro'||f.name.toLowerCase().includes('ipva'))?' <span class="tag" style="background:rgba(52,214,172,0.2);color:#34d6ac;font-size:10px;padding:2px 6px;">🛡️ BLINDADA</span>':''}</td><td class="positive">${secretMoney(f.amount)}</td><td><button data-fund-edit="${esc(f.id)}">Editar</button> <button data-fund-delete="${esc(f.id)}" class="ghost danger">Excluir</button></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma caixinha criada','Toque em Guardar dinheiro para começar.')}
    </section>
  `;
}
function reports(){
  const es=selected(),t=totals(es),by=Object.create(null);
  es.filter(e=>e.type==='income').forEach(e=>{if(e.mode==='daily'&&e.breakdown)Object.entries(e.breakdown).forEach(([k,v])=>by[k]=(by[k]||0)+v);else by[e.app]=(by[e.app]||0)+e.amount;});
  
  const weekDays = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const dailyNet = {};
  es.forEach(e => {
    if(!dailyNet[e.date]) dailyNet[e.date] = 0;
    if(e.type === 'income') dailyNet[e.date] += e.amount;
    if(e.type === 'expense') dailyNet[e.date] -= e.amount;
  });
  const byDay = {}, byDayCount = {};
  Object.entries(dailyNet).forEach(([date, net]) => {
    const wd = weekDays[new Date(date + 'T12:00:00').getDay()];
    byDay[wd] = (byDay[wd] || 0) + net;
    byDayCount[wd] = (byDayCount[wd] || 0) + 1;
  });
  const weekAvg = Object.keys(byDay).map(wd => ({ day: wd, avg: byDay[wd] / byDayCount[wd] })).sort((a,b) => b.avg - a.avg);
  const weekHtml = weekAvg.length ? weekAvg.map((w,i) => `<div class="list-row"><span>${i===0?'🏆':i===1?'🥈':i===2?'🥉':(i+1)+'º'} ${w.day}</span><strong>${money(w.avg)} <small>/dia</small></strong></div>`).join('') : empty('Sem dados','Trabalhe em diferentes dias da semana.');

  return `${cards(t)}<section class="panel" style="margin-bottom:22px"><h2>Evolução do período</h2><p class="muted">Agrupamento automático por dia, mês ou ano • valores em R$</p>${chart(true)}</section><section class="panel" style="margin-bottom:22px"><h2>Fluxo do Dinheiro (Cascata)</h2><p class="muted">Veja exatamente como suas despesas reduzem o seu ganho.</p>${waterfallChart()}</section><div class="split"><section class="panel"><div class="panel-head"><h2>Resultado detalhado</h2><div class="actions"><button data-action="csv">Exportar CSV</button><button data-action="print">Imprimir</button><button type="button" class="primary" onclick="window.gerarComprovanteRendaPDF()" style="background: linear-gradient(135deg, #1e3a8a, #0284c7); border: none; font-weight: 750; font-size: 12px; display: inline-flex; align-items: center; gap: 6px;">📄 Comprovante de Renda (PDF)</button></div></div>${[['Ganhos recebidos',money(t.income)],['Despesas pagas',money(t.expense)],['Saldo do período',money(t.net)],['Margem sobre os ganhos',t.income?number(t.net/t.income*100)+'%':'—'],['Ganho por km registrado',t.km?money(t.income/t.km):'—'],['Despesa por km registrado',t.km?money(t.expense/t.km):'—'],['Saldo por hora registrada',t.hours?money(t.net/t.hours):'—']].map(([k,v])=>`<div class="list-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}<p class="notice">Indicadores dependem dos dados informados. No fechamento, inclua espera e deslocamentos sem passageiro. Custos fixos e impostos só entram se registrados como despesas.</p></section><div><section class="panel" style="margin-bottom:20px"><h2>Ganhos por aplicativo</h2>${Object.keys(by).length?Object.entries(by).map(([k,v])=>`<div class="list-row"><span>${esc(k)}</span><strong>${money(v)}</strong></div>`).join(''):empty('Sem ganhos no período','Registre seus primeiros resultados.')}</section><section class="panel"><h2>Dias mais lucrativos</h2><p class="muted">Média de lucro líquido (ganhos - despesas) por dia da semana.</p>${weekHtml}</section></div></div>`;
}
function goals(){const s=state(),today=dateKey(),day=totals(s.entries.filter(e=>e.date===today)),month=totals(s.entries.filter(e=>e.date.slice(0,7)===today.slice(0,7)&&e.date<=today)),reserve=s.funds.reduce((n,f)=>n+f.amount,0);return `<div class="actions" style="margin-bottom:20px"><button class="primary" data-action="goals">Editar objetivos</button></div><div class="settings-grid"><section class="panel">${goalPanel('Meta diária',day.net,s.goals.daily,'Saldo de hoje, antes de provisões.')}</section><section class="panel">${goalPanel('Meta mensal',month.net,s.goals.monthly,'Saldo do mês atual, antes de provisões.')}</section><section class="panel">${goalPanel('Reserva financeira',reserve,s.goals.reserve,'Total de aportes registrados em Reservas.')}</section></div>`;}
function profile(){
  const trash=state().trash||[];
  const notifGranted=window.CapitalexNotifier?.getPermission()==='granted';
  const refData = window.CapitalexSession?.referral || { balance: 0, total_earned: 0, active_referrals: 0, pix_key: '', pix_key_type: 'CPF' };
  const userEmail = window.CapitalexSession?.email || '';
  const refLink = window.location.origin + '/?ref=' + encodeURIComponent(userEmail);
  const waMsg = encodeURIComponent(`Fala parceiro! Tô usando o Capitalex Driver pra controlar meus ganhos da Uber e 99 e ver meu lucro líquido de verdade. Entra pelo meu link que você ganha 10 DIAS GRÁTIS de teste: ${refLink}`);

  const referralHtml = userEmail ? `
    <section class="panel full" style="border: 1px solid var(--primary); background: linear-gradient(135deg, rgba(52, 214, 172, 0.08), rgba(18, 30, 45, 0.95));">
      <div class="panel-head">
        <div>
          <h2>🤝 Indique e Ganhe (Ganha-Ganha)</h2>
          <p class="muted">Seu amigo ganha <strong>10 dias de teste grátis</strong> (em vez de 7) e você ganha no Pix: <strong>R$ 8,00</strong> todo mês ou <strong>R$ 25,00</strong> no trimestral, podendo abater na sua assinatura!</p>
        </div>
        <span class="tag" style="background: var(--primary); color: #081320; font-weight: 800;">GANHA-GANHA</span>
      </div>
      
      <div class="cards" style="margin-bottom: 20px;">
        <div class="card"><span class="card-title">Amigos Ativos</span><span class="card-val">${refData.active_referrals || 0}</span><small>Mensalidade em dia</small></div>
        <div class="card"><span class="card-title">Saldo a Receber</span><span class="card-val positive">${money(refData.balance || 0)}</span><small>Comissões no Pix</small></div>
        <div class="card"><span class="card-title">Total Já Ganho</span><span class="card-val">${money(refData.total_earned || 0)}</span><small>Acumulado total</small></div>
      </div>

      <div style="background: var(--surface); padding: 16px; border-radius: 12px; border: 1px solid var(--line); margin-bottom: 16px;">
        <label style="font-weight: 700; margin-bottom: 6px; display: block;">Seu Link Exclusivo de Indicação</label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="text" readonly value="${esc(refLink)}" id="referralLinkInput" style="flex: 1; min-width: 220px; padding: 10px 14px; background: #060e18; border: 1px solid var(--line); border-radius: 8px; color: var(--text); font-size: 0.9rem;" onclick="this.select()">
          <button type="button" class="primary" onclick="copyRefLink()" style="white-space: nowrap;">📋 Copiar Link</button>
          <a href="https://api.whatsapp.com/send?text=${waMsg}" target="_blank" rel="noopener noreferrer" style="background: #22c55e; color: #081320; font-weight: 800; text-decoration: none; padding: 10px 16px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">
            📲 Mandar no WhatsApp
          </a>
        </div>
      </div>

      <div style="background: var(--surface); padding: 16px; border-radius: 12px; border: 1px solid var(--line);">
        <label style="font-weight: 700; margin-bottom: 6px; display: block;">Sua Chave Pix para Receber as Comissões</label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
          <select id="pixKeyType" style="padding: 10px; border-radius: 8px; border: 1px solid var(--line); background: #060e18; color: var(--text);">
            <option value="CPF" ${refData.pix_key_type==='CPF'?'selected':''}>CPF</option>
            <option value="Telefone" ${refData.pix_key_type==='Telefone'?'selected':''}>Telefone</option>
            <option value="E-mail" ${refData.pix_key_type==='E-mail'?'selected':''}>E-mail</option>
            <option value="Aleatória" ${refData.pix_key_type==='Aleatória'?'selected':''}>Chave Aleatória</option>
          </select>
          <input type="text" id="pixKeyInput" value="${esc(refData.pix_key||'')}" placeholder="Digite sua chave Pix..." style="flex: 1; min-width: 200px; padding: 10px 14px; background: #060e18; border: 1px solid var(--line); border-radius: 8px; color: var(--text);">
          <button type="button" class="primary" onclick="salvarChavePix()" style="white-space: nowrap;">Salvar Chave Pix</button>
        </div>
        <small class="muted" style="display: block; margin-top: 6px;">O administrador transfere suas comissões diretamente para essa chave quando o saldo acumular.</small>
      </div>
    </section>
  ` : '';

  return `<div class="settings-grid">${referralHtml}<section class="panel"><h2>${esc(state().profile.name)||'Seu perfil'}</h2><p class="muted">Personalize a sua experiência.</p><div class="actions"><button data-action="profile" class="primary">Editar nome</button><button data-action="theme" class="ghost">🌓 Trocar Tema (Claro/Escuro)</button></div><p class="notice">Seus registros ficam vinculados à sua conta. Encerre a sessão em aparelhos compartilhados. Não cadastre dados de passageiros.</p></section><section class="panel"><h2>🔔 Lembretes e Bênçãos Diárias</h2><p class="muted">Receba mensagens abençoadas e lembretes para fechar seus ganhos (07:00, 12:30, 17:30 e 21:30).</p><div class="actions"><button data-action="enable-reminders" class="primary">${notifGranted?'✅ Lembretes Ativados':'🔔 Ativar Lembretes'}</button><button data-action="test-reminder" class="ghost">📲 Testar Lembrete Agora</button></div><p class="notice">Funciona diretamente no celular ou computador, mesmo com a aba em segundo plano.</p></section><section class="panel"><h2>Backup e recuperação</h2><p class="muted">Faça o download dos seus dados por segurança ou quando for trocar de celular.</p><div class="actions"><button data-action="backup" class="primary" ${storageIssue&&!demo?'disabled':''}>Baixar backup</button><button data-action="import" ${demo?'disabled':''}>Restaurar arquivo</button><button data-action="recovery" ${demo?'disabled':''}>Recuperar versão anterior</button></div><p class="notice">A cada gravação, a versão anterior fica guardada na sua conta. Exporte também uma cópia própria dos registros.</p>${storageIssue?'<button data-action="raw">Exportar dados originais para recuperação</button>':''}</section><section class="panel full"><h2>Lixeira recuperável</h2><p class="muted">Exclusões ficam guardadas na sua conta e também entram no backup. Restaurar não duplica ganhos já existentes.</p>${trash.length?`<div class="table-wrap"><table class="trash-table"><thead><tr><th>Excluído em</th><th>Registro</th><th>Valor</th><th>Ação</th></tr></thead><tbody>${[...trash].reverse().map(t=>`<tr><td>${displayDate(t.deletedAt)}</td><td>${esc(t.item.name||t.item.category||t.item.app)}<br><small>${displayDate(t.item.date)}</small></td><td>${money(t.item.amount)}</td><td><button data-restore="${esc(t.trashId)}">Restaurar</button></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhum registro excluído','Se você excluir um lançamento, poderá recuperá-lo aqui.')}</section><section class="panel"><h2>Seus dados e a privacidade</h2><p class="muted">Seus lançamentos são enviados ao servidor por conexão segura e ficam separados por conta. O pagamento é realizado diretamente via Pix de forma segura.</p><p class="notice">Os backups JSON contêm dados financeiros sem criptografia. Guarde-os em local protegido. Esta versão não substitui a proteção e a senha do seu aparelho.</p></section><section class="panel"><h2>Demonstração isolada</h2><p class="muted">Explore gráficos com dados fictícios sem misturá-los aos seus lançamentos.</p><button data-action="demo">${demo?'Sair da demonstração':'Explorar demonstração'}</button></section><section class="panel full" style="border:1px dashed var(--line);background:rgba(10,23,37,0.3);text-align:center;padding:16px;"><p style="font-size:11.5px;color:var(--muted);line-height:1.6;margin:0 0 8px;"><strong>Aviso Legal:</strong> Uber, 99 e inDrive são marcas registradas de seus respectivos proprietários. O Capitalex Driver é um utilitário independente de gestão operacional pessoal sem vínculo ou representação com referidas empresas. Os demonstrativos têm caráter gerencial e estimativo com base nos lançamentos informados pelo usuário.</p><div style="font-size:12px;"><a href="termos.html" target="_blank" style="color:var(--green);text-decoration:underline;">Termos de Uso</a> • <a href="privacidade.html" target="_blank" style="color:var(--green);text-decoration:underline;">Política de Privacidade (LGPD)</a></div></section></div>`;
}
window.copyRefLink = () => {
  const inp = document.getElementById('referralLinkInput');
  if (inp) {
    inp.select();
    navigator.clipboard.writeText(inp.value);
    if (window.toast) window.toast('Link de indicação copiado!');
    else alert('Link copiado!');
  }
};
window.salvarChavePix = async () => {
  const key = document.getElementById('pixKeyInput')?.value.trim();
  const type = document.getElementById('pixKeyType')?.value || 'CPF';
  if (!key) return alert('Digite a sua chave Pix.');
  try {
    const res = await window.Account?.savePix(key, type);
    if (window.toast) window.toast(res?.message || 'Chave Pix salva!');
    else alert(res?.message || 'Chave Pix salva!');
    if (window.CapitalexSession?.referral) {
      window.CapitalexSession.referral.pix_key = key;
      window.CapitalexSession.referral.pix_key_type = type;
    }
  } catch (err) {
    alert(err.message || 'Erro ao salvar chave Pix.');
  }
};
window.configIpvaGoal = () => {
  const current = localStorage.getItem('cap_ipva_goal') || state().profile.ipvaGoal || '2400';
  const val = prompt('Qual o valor total estimado do seu IPVA + Seguro para o próximo ano? (R$)', current);
  if (val !== null) {
    const num = parseFloat(val.replace(',', '.'));
    if (num > 0) {
      localStorage.setItem('cap_ipva_goal', num);
      mutate(s => {
        s.profile.ipvaGoal = num;
      }, `Meta do IPVA & Seguro definida para ${money(num)}!`);
    }
  }
};
function calculadora(){
  setTimeout(() => { window.runCalc?.(); window.runFuelCompare?.(); }, 50);
  return `<div class="split">
    <!-- Bloco 1: Simulador de Corrida (Raio-X) -->
    <section class="panel">
      <div class="panel-head">
        <div><h2>🚗 Simulador de Corrida</h2><p>Avalie a corrida da Uber/99 em 5 segundos antes de aceitar</p></div>
        <span class="tag">RAIO-X</span>
      </div>
      <div class="form-grid">
        ${input('calcVal','Valor da Corrida (R$)','','number','step="0.01" oninput="runCalc()" inputmode="decimal" placeholder="Ex: 24.50"')}
        ${input('calcKm','Distância Total (KM)','','number','step="0.1" oninput="runCalc()" inputmode="decimal" placeholder="Ex: 8.5"')}
        ${input('calcMin','Tempo Estimado (Minutos)','','number','step="1" oninput="runCalc()" inputmode="numeric" placeholder="Ex: 20"')}
        ${input('calcGas','Preço Combustível (R$/L)',localStorage.getItem('cap_gas_price')||'5.80','number','step="0.01" oninput="runCalc()" inputmode="decimal"')}
        ${input('calcCons','Autonomia do Carro (km/L)',localStorage.getItem('cap_calc_cons')||state().profile.consumption||'10.0','number','step="0.1" oninput="runCalc()" inputmode="decimal" placeholder="Ex: 10.0"')}
      </div>
      <div id="calcResults" style="margin-top:16px;">
        <div class="empty" style="padding:20px 10px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;color:var(--muted);opacity:0.3;margin-bottom:10px;"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          <strong>Aguardando dados...</strong>
          <p>Preencha os valores para ver o veredito.</p>
        </div>
      </div>
    </section>

    <!-- Bloco 2: Comparador na Bomba (Item 7) -->
    <section class="panel">
      <div class="panel-head">
        <div><h2>⛽ Bomba: Etanol x Gasolina x GNV</h2><p>Descubra no posto qual combustível dá mais lucro</p></div>
        <span class="tag" style="background:rgba(52,214,172,0.18);color:#34d6ac;font-weight:800;">ECONOMIA</span>
      </div>
      <div class="form-grid">
        ${input('fuelGasPrice','Gasolina na Bomba (R$/L)',localStorage.getItem('cap_pump_gas')||'5.89','number','step="0.01" oninput="runFuelCompare()" inputmode="decimal"')}
        ${input('fuelEthPrice','Etanol na Bomba (R$/L)',localStorage.getItem('cap_pump_eth')||'3.89','number','step="0.01" oninput="runFuelCompare()" inputmode="decimal"')}
        ${input('fuelGasKm','Consumo Gasolina (km/L)',state().profile.consumption||'10.0','number','step="0.1" oninput="runFuelCompare()" inputmode="decimal"')}
        ${input('fuelEthKm','Consumo Etanol (km/L)',(Math.round((state().profile.consumption||10)*0.7*10)/10).toFixed(1),'number','step="0.1" oninput="runFuelCompare()" inputmode="decimal"')}
        ${input('fuelTank','Capacidade do Tanque (L)','50','number','step="1" oninput="runFuelCompare()" inputmode="numeric"')}
        ${input('fuelGnvPrice','GNV R$/m³ (Opcional)',localStorage.getItem('cap_pump_gnv')||'','number','step="0.01" oninput="runFuelCompare()" inputmode="decimal" placeholder="Opcional"')}
      </div>
      <div id="fuelResults" style="margin-top:16px;">
        <div class="empty" style="padding:20px 10px;">
          <strong>Calculando paridade...</strong>
        </div>
      </div>
    </section>
  </div>`;
}

window.runFuelCompare = () => {
  const getV = n => parseFloat($('input[name="'+n+'"]')?.value.replace(',','.')) || 0;
  const pGas = getV('fuelGasPrice');
  const pEth = getV('fuelEthPrice');
  const cGas = getV('fuelGasKm') || 10;
  const cEth = getV('fuelEthKm') || 7;
  const tank = getV('fuelTank') || 50;
  const pGnv = getV('fuelGnvPrice');

  if (pGas) localStorage.setItem('cap_pump_gas', pGas);
  if (pEth) localStorage.setItem('cap_pump_eth', pEth);
  if (pGnv) localStorage.setItem('cap_pump_gnv', pGnv);

  const container = document.getElementById('fuelResults');
  if (!container) return;

  if (!pGas || !pEth) {
    container.innerHTML = `
      <div class="empty" style="padding:20px 10px;">
        <strong>Preencha os preços da bomba</strong>
        <p>Informe o valor da Gasolina e do Etanol para comparar.</p>
      </div>
    `;
    return;
  }

  const costGasKm = pGas / cGas;
  const costEthKm = pEth / cEth;
  const ratio = (pEth / pGas) * 100;
  const carParity = (cEth / cGas) * 100;
  const ethWins = costEthKm < costGasKm;
  const diffPerKm = Math.abs(costGasKm - costEthKm);
  const savingsTank = ethWins ? diffPerKm * (tank * cEth) : diffPerKm * (tank * cGas);

  let gnvText = '';
  if (pGnv > 0) {
    const cGnv = cGas * 1.35;
    const costGnvKm = pGnv / cGnv;
    gnvText = `
      <div class="list-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);">
        <span>Custo por KM no GNV</span>
        <strong style="color:#38bdf8;">${money(costGnvKm)}/km <small>(~${number(cGnv)} km/m³)</small></strong>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="fuel-veredito ${ethWins ? 'eth-wins' : 'gas-wins'}">
      <div class="fuel-veredito-tag">VEREDITO DA INTELIGÊNCIA</div>
      <strong class="fuel-veredito-title">
        ${ethWins ? '🟢 ABASTEÇA COM ETANOL!' : '🔵 ABASTEÇA COM GASOLINA!'}
      </strong>
      <span class="fuel-veredito-sub">
        Economia de <strong>${money(savingsTank)}</strong> em um tanque cheio (${tank}L)
      </span>
    </div>

    <div class="list-row">
      <span>Custo por KM no Etanol</span>
      <strong class="${ethWins?'positive':''}">${money(costEthKm)}/km</strong>
    </div>
    <div class="list-row">
      <span>Custo por KM na Gasolina</span>
      <strong class="${!ethWins?'positive':''}">${money(costGasKm)}/km</strong>
    </div>
    <div class="list-row">
      <span>Relação de Preço (Bomba)</span>
      <div style="text-align:right;">
        <strong>${ratio.toFixed(1)}%</strong>
        <small style="display:block;font-size:11px;color:var(--muted);">(Paridade: ${carParity.toFixed(1)}%)</small>
      </div>
    </div>
    ${gnvText}

    <p class="notice" style="margin-top:14px;font-size:12px;">
      ${ethWins 
        ? `Neste posto, o Etanol custa ${ratio.toFixed(1)}% da Gasolina (abaixo dos ${carParity.toFixed(1)}% do seu motor), gerando ${money(diffPerKm)} de lucro extra a cada km rodado.`
        : `Neste posto, a Gasolina rende mais quilômetros por real no seu motor.`}
    </p>
  `;
};

window.runCalc=()=>{
  const getV=n=>parseFloat($('input[name="'+n+'"]')?.value.replace(',','.'))||0;
  const v=getV('calcVal'),km=getV('calcKm'),min=getV('calcMin'),gas=getV('calcGas'),cons=getV('calcCons');
  if(gas)localStorage.setItem('cap_gas_price',gas);
  if(cons)localStorage.setItem('cap_calc_cons',cons);
  if(!v||!km)return;
  const p=state().profile,consumption=cons||p.consumption||10,reserve=state().reservePerKm||0.15;
  const costGas=(km/consumption)*gas,costReserve=km*reserve,totalCost=costGas+costReserve;
  const net=v-totalCost,perKm=v/km,netPerKm=net/km,netPerHour=min?(net/(min/60)):0;
  let verdict='',vColor='';
  if(netPerKm>=1.5){verdict='Excelente Corrida! 🏆';vColor='var(--green)';}
  else if(netPerKm>=1.0){verdict='Boa Corrida 👍';vColor='var(--blue)';}
  else if(netPerKm>=0.5){verdict='Regular / Paga as contas 😐';vColor='var(--orange)';}
  else{verdict='Fria! Prejuízo na certa 🔴';vColor='#ffb1a7';}
  $('#calcResults').innerHTML=`
    <div style="text-align:center;padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:16px;">
       <h3 style="color:var(--muted);margin-bottom:4px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Veredito da Inteligência</h3>
       <strong style="font-size:22px;color:${vColor};">${verdict}</strong>
    </div>
    <div class="list-row"><span>Valor Bruto (R$/km)</span><strong>${money(perKm)}/km</strong></div>
    <div class="list-row"><span>Lucro Líquido (R$/km)</span><strong class="positive">${money(netPerKm)}/km</strong></div>
    ${min?`<div class="list-row"><span>Lucro por Hora</span><strong class="positive">${money(netPerHour)}/h</strong></div>`:''}
    <div class="list-row" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);">
       <span>Custo Combustível</span><strong class="negative">− ${money(costGas)}</strong>
    </div>
    <div class="list-row">
       <span>Custo Desgaste (Reserva)</span><strong class="negative">− ${money(costReserve)}</strong>
    </div>
    <div class="list-row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);">
       <span style="font-size:16px;">Lucro Limpo no Bolso</span><strong style="font-size:24px;color:${net>0?'var(--green)':'#ffb1a7'}">${money(net)}</strong>
    </div>
    <p class="notice" style="margin-top:16px;font-size:12.5px;">Cálculo baseado no seu veículo fazendo ${number(consumption)} km/L e poupando ${money(reserve)} por km para manutenção.</p>
  `;
};
function render(){chartInitializers=[];if(window.Chart){const isLight=document.documentElement.classList.contains('light-theme');Chart.defaults.color=isLight?'#475569':'#94a3b8';Chart.defaults.borderColor=isLight?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.05)';}const page=paths[route]||paths.dashboard;$('#pageTitle').textContent=page[0];$('#subtitle').textContent=page[1];const hr=new Date().getHours();const salutation=hr<12?'BOM DIA':hr<18?'BOA TARDE':'BOA NOITE';$('#greeting').textContent=state().profile.name?`${salutation}, ${state().profile.name.toLocaleUpperCase('pt-BR')}`:'CONTROLE FINANCEIRO';$('#demoBanner').hidden=!demo;$('#demoBtn').textContent=demo?'Sair da demonstração':'Ver demonstração';$('.toolbar').hidden=['veiculo','metas','perfil','investimentos','calculadora'].includes(route);$('#customDates').hidden=period!=='custom';const b=bounds();$('#periodLabel').textContent=period==='all'?'Todo o histórico':`${displayDate(b[0])} a ${displayDate(b[1])}`;$('nav').innerHTML=Object.entries(paths).map(([key,v])=>`<a href="#${key}" class="${key===route?'active':''}" ${key===route?'aria-current="page"':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${v[2]}"/></svg>${({dashboard:'Visão geral',corridas:'Ganhos',gastos:'Despesas',calculadora:'Calculadora',veiculo:'Veículo',investimentos:'Reservas',relatorios:'Relatórios',metas:'Metas',perfil:'Perfil e backup'})[key]}</a>`).join('');document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(a=>{a.classList.toggle('active',a.dataset.tab===route);});renderSafety();$('#content').innerHTML=({dashboard,corridas:gains,gastos:expenses,calculadora,veiculo:vehicle,investimentos:funds,relatorios:reports,metas:goals,perfil:profile}[route]||dashboard)();chartInitializers.forEach(init=>init());const hasToday=state().entries.some(e=>e.date===dateKey());$('#mobileQuickAdd')?.classList.toggle('pulse',!hasToday);}
function input(name,label,value='',type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function select(name,label,options,value){return `<label>${label}<select name="${name}">${options.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;}
const categories=['Combustível','Alimentação','Manutenção','Seguro','Aluguel do veículo','Parcela do veículo','Celular','Pedágio','Estacionamento','Impostos e taxas','Outros'];
function openForm(type,id){const s=state(),e=s.entries.find(e=>e.id===id)||s.funds.find(e=>e.id===id)||{};formContext={type,id};dirty=false;let title='',fields='';const date=input('date','Data',e.date||dateKey(),'date',`required min="2000-01-01" max="${dateKey()}"`);const amount=input('amount','Valor (R$)',e.amount??'','number','required min="0.01" step="0.01" max="10000000" inputmode="decimal"');if(type==='income'){title=id?'Editar corrida':'Registrar corrida';const ocrBtn='<div class="full" style="margin-bottom:12px"><button type="button" data-action="ocr" style="width:100%;background:rgba(52, 214, 172, 0.1);color:var(--primary);border:1px dashed var(--primary);font-weight:bold;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-right:6px;vertical-align:-4px;"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11z"/><circle cx="12" cy="13" r="4"/></svg> Ler Print (Auto-preencher Valor)</button></div>';const quickIncome = `<div class="full" style="display:flex;gap:8px;margin-bottom:6px;margin-top:-6px;overflow-x:auto;padding-bottom:4px;"><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='10.00'">R$ 10</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='15.00'">R$ 15</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='20.00'">R$ 20</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='30.00'">R$ 30</button></div>`;fields=ocrBtn+date+select('app','Aplicativo',['Uber','99','inDrive','Particular','Outros'],e.app)+amount+quickIncome+input('km','Quilômetros registrados (Opcional)',e.km??'','number','min="0" step="0.1" max="100000" inputmode="decimal"')+input('minutes','Tempo (Minutos) (Opcional)',e.hours?round(e.hours*60):'','number','min="0" max="1440" step="1" inputmode="numeric"')+input('description','Observação (opcional)',e.description||'','text','maxlength="160"')+'<p class="notice full">Para incluir espera e todos os deslocamentos no resultado por hora/km, prefira o fechamento diário.</p>';}
if(type==='daily'){
  title=id?'Editar fechamento':'Fechar dia';
  const autoIpvaField = `
    <div class="full" style="background:linear-gradient(135deg,rgba(52,214,172,0.1),rgba(15,35,55,0.7)); border:1.5px solid rgba(52,214,172,0.35); border-radius:14px; padding:14px 16px; margin:6px 0;">
      <label style="display:flex; align-items:center; gap:12px; cursor:pointer; font-weight:750; color:var(--text); margin:0;">
        <input type="checkbox" name="autoIpva" value="1" style="width:22px; height:22px; accent-color:var(--green); cursor:pointer;" checked>
        <span style="font-size:14.5px;">🛡️ Blindar IPVA & Seguro: Destinar 10% para a Caixinha</span>
      </label>
      <small style="color:var(--muted); display:block; margin-top:5px; margin-left:34px; font-size:12px; line-height:1.45;">
        Cria um débito virtual automático de 10% do faturamento de hoje na sua Caixinha Blindada do IPVA para chegar em janeiro com tudo pago sem juros no cartão.
      </small>
    </div>
  `;
  fields=date+input('count','Quantidade de corridas',e.count??'','number','required min="0" step="1" max="10000" inputmode="numeric"')+['Uber','99','inDrive','Particular','Outros'].map((app,i)=>input('app'+i,app+' (R$)',e.breakdown?.[app]??(app==='Outros'&&e.mode==='daily'&&!e.breakdown?e.amount:0),'number','required min="0" step="0.01" max="10000000" inputmode="decimal"')).join('')+input('km','KM totais do trabalho',e.km??'','number','required min="0" step="0.1" max="100000" inputmode="decimal"')+input('hours','Horas totais (ex: 8.5 para 8h30)',e.hours??'','number','required min="0" step="0.1" max="24" inputmode="decimal"')+autoIpvaField+input('description','Observação (opcional)',e.description||'','text','maxlength="160"')+'<p class="notice full">Inclua espera e km sem passageiro. Lance despesas separadamente em Despesas. O valor recebido deve ser o repasse ao motorista, sem descontar a taxa do aplicativo novamente.</p>';
}
if(type==='expense'){
  title=id?'Editar despesa':'Registrar despesa';
  const quickExpense = `
    <div class="full" style="background:rgba(255,180,107,0.08);border:1.5px solid rgba(255,180,107,0.3);border-radius:14px;padding:12px 14px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:800;color:var(--orange);letter-spacing:0.8px;text-transform:uppercase;">⚡ Lançamento Ultra-Rápido no Posto</span>
        <small style="color:var(--muted);font-size:11px;">1 toque preenche tudo</small>
      </div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;border-color:rgba(255,180,107,0.45);font-weight:750;" onclick="window.quickFillFuel(50)">⛽ R$ 50</button>
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;border-color:rgba(255,180,107,0.45);font-weight:750;" onclick="window.quickFillFuel(80)">⛽ R$ 80</button>
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;border-color:rgba(255,180,107,0.45);font-weight:750;" onclick="window.quickFillFuel(100)">⛽ R$ 100</button>
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;border-color:rgba(255,180,107,0.45);font-weight:750;" onclick="window.quickFillFuel(150)">⛽ R$ 150</button>
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;border-color:rgba(255,180,107,0.45);font-weight:750;" onclick="window.quickFillFuel(200)">⛽ R$ 200</button>
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;" onclick="window.quickFillFood(25)">🍔 R$ 25</button>
        <button type="button" class="ghost" style="padding:8px 14px;font-size:13px;white-space:nowrap;" onclick="window.quickFillFood(35)">🍔 R$ 35</button>
      </div>
    </div>
  `;
  fields=quickExpense+date+select('category','Categoria',categories,e.category||'Combustível')+amount+input('description','Descrição (opcional)',e.description||'Abastecimento','text','maxlength="160"');
}
if(type==='fund'){title=id?'Editar aporte':'Registrar aporte';fields=date+'<label>Caixinha / Objetivo<input name="name" list="fundOpts" value="'+esc(e.name||'IPVA e Seguro')+'" required maxlength="100"><datalist id="fundOpts"><option value="IPVA e Seguro"></option><option value="Reserva de emergência"></option><option value="Férias e 13º"></option><option value="Manutenção do Carro"></option></datalist></label>'+amount;}
if(type==='vehicle'){
  title='Configurar veículo';
  const vt = s.profile.vehicleType || 'own';
  const rentW = s.profile.rentWeekly || 650;
  const rentD = s.profile.rentDay || 'Sexta';
  const rentWD = s.profile.rentWorkDays || 6;
  const rentKm = s.profile.rentKmLimit || 1250;
  const oilKm = s.profile.oilChangeKm || (Number(s.profile.odometer) + 10000);
  const brakesKm = s.profile.brakesKm || (Number(s.profile.odometer) + 30000);
  const tiresKm = s.profile.tiresKm || (Number(s.profile.odometer) + 10000);

  const vehicleTypeSelect = `
    <div class="full" style="background:rgba(52,214,172,0.08);border:1px solid rgba(52,214,172,0.25);border-radius:12px;padding:12px 14px;margin-bottom:8px;">
      <label style="font-weight:750;color:var(--text);margin-bottom:6px;">Tipo de Posse do Veículo
        <select name="vehicleType" id="cfgVehicleType" onchange="window.toggleVehicleTypeCfg(this.value)">
          <option value="own" ${vt!=='rent'?'selected':''}>🚗 Carro Próprio (Financiado ou Quitado)</option>
          <option value="rent" ${vt==='rent'?'selected':''}>🏢 Carro Alugado (Kovi, Localiza, Movida, Unidas...)</option>
        </select>
      </label>
    </div>
  `;

  const rentFields = `
    <div id="cfgRentBlock" class="full" style="${vt==='rent'?'':'display:none;'}background:rgba(67,166,255,0.06);border:1px solid rgba(67,166,255,0.2);border-radius:12px;padding:14px;margin-bottom:10px;">
      <h3 style="color:#38bdf8;margin:0 0 10px;font-size:14px;display:flex;align-items:center;gap:6px;">🏢 Dados do Aluguel do Carro</h3>
      <div class="form-grid">
        ${input('rentWeekly','Valor Semanal do Aluguel (R$)',rentW,'number','min="0" step="0.01" inputmode="decimal"')}
        ${input('rentWorkDays','Dias trabalhados na semana',rentWD,'number','min="1" max="7" step="1" inputmode="numeric"')}
        ${select('rentDay','Dia da Cobrança',['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'],rentD)}
        ${input('rentKmLimit','Franquia Semanal de KM (Opcional)',rentKm,'number','min="0" step="10" inputmode="numeric"')}
      </div>
      <p class="notice full" style="margin-top:10px;font-size:12px;">O valor diário fixo será calculado para compor seu custo diário real de trabalho.</p>
    </div>
  `;

  const ownFields = `
    <div id="cfgOwnBlock" class="full" style="${vt!=='rent'?'':'display:none;'}">
      <div class="form-grid">
        ${input('reservePerKm','Reserva sugerida por km (R$)',s.reservePerKm,'number','required min="0" max="100" step="0.01" inputmode="decimal"')}
        ${input('oilChangeKm','Próxima Troca de Óleo: hodômetro-alvo',oilKm,'number','min="0" step="100" inputmode="numeric"')}
        ${input('brakesKm','Próxima Pastilha de Freio: hodômetro-alvo',brakesKm,'number','min="0" step="500" inputmode="numeric"')}
        ${input('tiresKm','Próximo Rodízio de Pneus: hodômetro-alvo',tiresKm,'number','min="0" step="500" inputmode="numeric"')}
        ${input('ipva','Data Venc. IPVA (Opcional)',s.profile.ipva||'','date','')}
        ${input('seguro','Data Venc. Seguro (Opcional)',s.profile.seguro||'','date','')}
      </div>
    </div>
  `;

  fields = vehicleTypeSelect +
    input('vehicle','Modelo do Veículo',s.profile.vehicle,'text','required maxlength="100"') +
    input('odometer','Hodômetro Atual (KM)',s.profile.odometer,'number','required min="0" max="10000000" step="1" inputmode="numeric"') +
    input('consumption','Consumo Médio (KM/L)',s.profile.consumption,'number','required min="0" max="100" step="0.1" inputmode="decimal"') +
    rentFields +
    ownFields;
}
if(type==='goals'){title='Editar metas';fields=input('daily','Saldo diário desejado (R$)',s.goals.daily,'number','required min="1" max="10000000" step="0.01" inputmode="decimal"')+input('monthly','Saldo mensal desejado (R$)',s.goals.monthly,'number','required min="1" max="10000000" step="0.01" inputmode="decimal"')+input('reserve','Objetivo de reserva (R$)',s.goals.reserve,'number','required min="1" max="10000000" step="0.01" inputmode="decimal"');}
if(type==='profile'){title='Seu nome';fields=input('name','Como você prefere ser chamado?',s.profile.name,'text','required maxlength="60"');}
$('#modalTitle').textContent=title;$('#fields').innerHTML=`<div class="form-grid">${fields}</div>`;$('#formError').textContent='';$('#modal').showModal();}
async function saveForm(ev){ev.preventDefault();if(saving)return;const f=Object.fromEntries(new FormData(ev.target)),{type,id}=formContext,s=state(),n=k=>Number(f[k]);let e;if(['income','daily','expense','fund'].includes(type)&&(!validDate(f.date)||f.date>dateKey()))return formError('Informe uma data válida, até hoje.');
let ipvaAutoAmount=0;
if(type==='income'||type==='daily'){const conflicts=s.entries.filter(e=>e.id!==id&&e.type==='income'&&e.date===f.date);if(conflicts.some(e=>e.mode==='daily')||(type==='daily'&&conflicts.length))return formError('Já existem ganhos neste dia. Edite o fechamento existente ou remova as corridas antes de criar um fechamento.');let breakdown;let amount=n('amount');if(type==='daily'){breakdown={};['Uber','99','inDrive','Particular','Outros'].forEach((app,i)=>breakdown[app]=n('app'+i));amount=round(Object.values(breakdown).reduce((a,b)=>a+b,0));if(f.autoIpva&&amount>0)ipvaAutoAmount=round(amount*0.10);}if(!finite(amount,.01))return formError('Informe pelo menos um ganho maior que zero.');const hours=type==='daily'?n('hours'):n('minutes')/60;if(hours+conflicts.reduce((sum,e)=>sum+e.hours,0)>24)return formError('O tempo total registrado neste dia não pode ultrapassar 24 horas.');e={id:id||uid(),type:'income',mode:type==='daily'?'daily':'ride',date:f.date,app:type==='daily'?'Todos':f.app,amount:round(amount),km:n('km'),hours,count:type==='daily'?n('count'):1,description:f.description.trim(),...(breakdown?{breakdown}:{})};}
if(type==='expense')e={id:id||uid(),type:'expense',date:f.date,amount:round(n('amount')),category:f.category,description:f.description.trim()};
const next=JSON.parse(JSON.stringify(s));if(e){const i=next.entries.findIndex(x=>x.id===id);if(i<0)next.entries.push(e);else next.entries[i]=e;}
if(type==='daily'&&ipvaAutoAmount>=1){const fIdx=next.funds.findIndex(x=>x.date===f.date&&(x.name==='IPVA e Seguro'||x.name==='🛡️ IPVA & Seguro'));if(fIdx>=0)next.funds[fIdx].amount=ipvaAutoAmount;else next.funds.push({id:uid(),date:f.date,name:'IPVA e Seguro',amount:ipvaAutoAmount});}
if(type==='fund'){const fund={id:id||uid(),date:f.date,name:f.name.trim(),amount:round(n('amount'))};if(!fund.name)return formError('Informe o objetivo do aporte.');const i=next.funds.findIndex(x=>x.id===id);if(i<0)next.funds.push(fund);else next.funds[i]=fund;}
if(type==='vehicle'){
  const odo = n('odometer');
  next.profile={
    ...next.profile,
    vehicle:f.vehicle.trim(),
    odometer:odo,
    serviceAt:n('serviceAt')||(odo+10000),
    consumption:n('consumption'),
    vehicleType:f.vehicleType||'own',
    rentWeekly:n('rentWeekly')||650,
    rentWorkDays:n('rentWorkDays')||6,
    rentDay:f.rentDay||'Sexta',
    rentKmLimit:n('rentKmLimit')||0,
    oilChangeKm:n('oilChangeKm')||(odo+10000),
    brakesKm:n('brakesKm')||(odo+30000),
    tiresKm:n('tiresKm')||(odo+10000),
    ipva:f.ipva||'',
    seguro:f.seguro||''
  };
  if(f.reservePerKm!==undefined)next.reservePerKm=n('reservePerKm');
}
if(type==='goals')next.goals={daily:n('daily'),monthly:n('monthly'),reserve:n('reserve')};
if(type==='profile'){if(!f.name.trim())return formError('Informe seu nome.');next.profile.name=f.name.trim();}
if(!validBackup(next))return formError('Confira os valores informados. Não foi possível salvar.');
const successMsg = (type==='daily'&&ipvaAutoAmount>0)?`Fechamento salvo! 🛡️ ${money(ipvaAutoAmount)} guardados no IPVA & Seguro!`:(type === 'income' ? 'Ganho salvo com sucesso!' : type === 'expense' ? 'Despesa salva com sucesso!' : 'Registro salvo com sucesso!');
if(await commit(next,demo?'Salvo na demonstração.':successMsg)){dirty=false;$('#modal').close();}
}
function formError(msg){$('#formError').textContent=msg;}
function remove(id,fund=false){const key=fund?'funds':'entries',item=state()[key].find(e=>e.id===id);if(!item)return;if((state().trash||[]).length>=5000)return toast('A lixeira atingiu o limite. Exporte um backup e preserve seus registros antes de continuar.');if(!confirm(`Mover o registro de ${money(item.amount)} para a lixeira? Você poderá recuperá-lo em Perfil e backup.`))return;mutate(s=>{s[key]=s[key].filter(e=>e.id!==id);s.trash=s.trash||[];s.trash.push({trashId:uid(),key,item,deletedAt:dateKey()});},'Registro movido para a lixeira. Você pode restaurá-lo em Perfil.');}
function restoreTrash(id){const t=(state().trash||[]).find(x=>x.trashId===id);if(!t)return;const next=JSON.parse(JSON.stringify(state()));next[t.key].push(t.item);next.trash=next.trash.filter(x=>x.trashId!==id);if(!validBackup(next))return toast('Não foi possível restaurar: existe ganho duplicado, conflito de horas ou registro incompatível.');commit(next,'Registro restaurado.');}
function download(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(){const quote=v=>'"'+String(v??'').replace(/^[\s\u0000-\u001f]*[=+@\-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['Data','Tipo','Aplicativo ou categoria','Descrição','Valor BRL','KM','Horas','Corridas'],...selected().map(e=>[e.date,e.type==='income'?'Ganho':'Despesa',e.app||e.category,e.description,Number(e.amount).toFixed(2).replace('.',','),e.km??'',e.hours??'',e.count??''])];download(`capitalex-relatorio-${dateKey()}.csv`,'\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
function toggleDemo(){undo=null;if(demo){demo=null;render();return;}demo=defaults();demo.profile={name:'Motorista',vehicle:'Sedã 2022',odometer:68420,serviceAt:70000,consumption:12.4};demo.goals={daily:400,monthly:8000,reserve:20000};[320,410,390,480,520,610,428].forEach((amount,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const date=dateKey(d);demo.entries.push({id:uid(),type:'income',mode:'daily',date,amount,app:'Todos',breakdown:{Uber:round(amount*.7),'99':round(amount*.3)},km:round(amount/2.3),hours:8,count:20+i,description:'Exemplo de fechamento'});demo.entries.push({id:uid(),type:'expense',date,amount:round([82,88,82,95,111,119,104][i]*.75),category:'Combustível',description:'Exemplo de despesa'});demo.entries.push({id:uid(),type:'expense',date,amount:round([82,88,82,95,111,119,104][i]*.25),category:i%2?'Celular':'Alimentação',description:'Exemplo de despesa'});});demo.funds=[{id:uid(),date:dateKey(),name:'Reserva de emergência',amount:5000}];render();}
document.addEventListener('click',async ev=>{if(saving)return;const b=ev.target.closest('button');const aTag=ev.target.closest('a');if((b||aTag)&&navigator.vibrate)navigator.vibrate(30);if(!b)return;if(b.dataset.edit){const e=state().entries.find(e=>e.id===b.dataset.edit);openForm(e.type==='income'?(e.mode==='daily'?'daily':'income'):'expense',e.id);}if(b.dataset.delete)remove(b.dataset.delete);if(b.dataset.restore)restoreTrash(b.dataset.restore);if(b.dataset.fundEdit)openForm('fund',b.dataset.fundEdit);if(b.dataset.fundDelete)remove(b.dataset.fundDelete,true);const a=b.dataset.action;if(!a)return;if(a==='ocr')return $('#ocrInput').click();if(a==='theme'){document.documentElement.classList.toggle('light-theme');const isLight = document.documentElement.classList.contains('light-theme');localStorage.setItem('capitalex_theme',isLight?'light':'dark');if(window.Chart){Chart.defaults.color=isLight?'#475569':'#94a3b8';Chart.defaults.borderColor=isLight?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.05)';Object.values(Chart.instances).forEach(c=>c.update());}}if(['income','expense','daily','vehicle','goals','profile','fund'].includes(a))openForm(a);if(a==='enable-reminders'){if(window.CapitalexNotifier){await window.CapitalexNotifier.requestPermission();render();}}if(a==='dismiss-reminders'){localStorage.setItem('capitalex_reminders_dismissed','true');render();}if(a==='test-reminder'){if(window.CapitalexNotifier){await window.CapitalexNotifier.testReminder();}}if(a==='reload')reloadData();if(a==='recovery')recoverPrevious();if(a==='raw')exportRaw();if(a==='csv')csv();if(a==='print')window.print();if(a==='backup')download(`capitalex-${demo?'demonstracao-':''}backup-${dateKey()}.json`,JSON.stringify(state(),null,2),'application/json');if(a==='import'&&!demo)$('#importFile').click();if(a==='demo')toggleDemo();if(a==='undo'&&undo&&undo.demo===!!demo){const u=undo;const duplicate=state()[u.key].some(e=>e.id===u.item.id);const dayConflict=u.key==='entries'&&u.item.type==='income'&&state().entries.some(e=>e.type==='income'&&e.date===u.item.date&&(e.mode==='daily'||u.item.mode==='daily'));if(duplicate||dayConflict)return toast('Não é possível restaurar: há um registro conflitante.');if(await mutate(s=>s[u.key].push(u.item),'Exclusão desfeita.')){undo=null;render();}}});
$('#editForm').addEventListener('submit',saveForm);$('#closeModal').onclick=$('#cancelModal').onclick=closeForm;$('#editForm').addEventListener('input',()=>dirty=true);$('#editForm').addEventListener('change',()=>dirty=true);$('#modal').addEventListener('cancel',e=>{e.preventDefault();closeForm();});$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeForm();});$('#demoBtn').onclick=$('#exitDemo').onclick=toggleDemo;
$('#mobileQuickAdd')?.addEventListener('click',()=>$('#quickAddSheet')?.showModal());
$('#mobileMenuBtn')?.addEventListener('click',()=>$('#moreMenuSheet')?.showModal());
document.querySelectorAll('.close-sheet').forEach(b=>b.addEventListener('click',e=>e.target.closest('dialog')?.close()));
document.querySelectorAll('[data-sheet-action]').forEach(b=>b.addEventListener('click',e=>{const act=e.currentTarget.dataset.sheetAction;$('#quickAddSheet')?.close();openForm(act);}));
$('#mobileSheetAccount')?.addEventListener('click',()=>{const m=$('#moreMenuSheet');if(m)m.close();$('#accountMenu')?.click();});
$('#mobileSheetLogout')?.addEventListener('click',()=>{const m=$('#moreMenuSheet');if(m)m.close();$('#accountLogout')?.click();});
$('#moreMenuSheet')?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{const m=$('#moreMenuSheet');if(m)m.close();}));
['quickAddSheet','moreMenuSheet'].forEach(id=>{const d=document.getElementById(id);d?.addEventListener('click',e=>{if(e.target===d)d.close();});});
$('#period').onchange=e=>{period=e.target.value;render();};$('#from').value=$('#to').value=dateKey();['from','to'].forEach(id=>{$('#'+id).min='2000-01-01';$('#'+id).max=dateKey();});['from','to'].forEach(id=>$('#'+id).onchange=()=>{if(!validDate($('#'+id).value)||$('#'+id).value<'2000-01-01'||$('#'+id).value>dateKey()){$('#'+id).value=dateKey();toast('Escolha uma data válida entre 2000 e hoje.');}if($('#from').value>$('#to').value){toast('A data inicial precisa ser anterior à data final.');$('#'+id).value=id==='from'?$('#to').value:$('#from').value;}render();});

$('#importFile').onchange=async ev=>{const file=ev.target.files[0];ev.target.value='';if(!file)return;if(file.size>950000)return toast('Backup muito grande. Limite: 950 KB nesta versão.');try{const data=parseBackup(await file.text());if(!confirm(`Restaurar ${data.entries.length} lançamentos, ${data.funds.length} aportes e ${data.trash.length} itens na lixeira? Seus dados atuais serão substituídos. Uma cópia anterior será preservada na sua conta.`))return;await commit(data,'Backup validado e restaurado.',true);}catch(e){toast('Arquivo recusado: dados inválidos, datas futuras, valores inconsistentes ou ganhos duplicados. Nada foi alterado.');}};
$('#ocrInput').onchange=async ev=>{
  const file=ev.target.files[0];ev.target.value='';if(!file)return;
  if(!window.Tesseract)return toast('O leitor de inteligência artificial ainda está carregando. Tente novamente em 5 segundos.');
  const btn=$('button[data-action="ocr"]');
  if(btn){btn.dataset.original=btn.innerHTML;btn.innerHTML='⏳ Baixando IA e lendo imagem...';btn.disabled=true;}
  toast('Iniciando Inteligência Artificial... a 1ª vez demora um pouco para baixar os pacotes visuais.');
  try{
    const img=new Image();img.src=URL.createObjectURL(file);await new Promise(r=>img.onload=r);
    const cvs=document.createElement('canvas');const maxW=1000;let w=img.width,h=img.height;
    if(w>maxW){h=Math.round((h*maxW)/w);w=maxW;}
    cvs.width=w;cvs.height=h;cvs.getContext('2d').drawImage(img,0,0,w,h);
    const blob=await new Promise(r=>cvs.toBlob(r,'image/jpeg',0.8));
    const res=await Tesseract.recognize(blob,'por',{logger:m=>{if(m.status==='recognizing text'&&btn)btn.innerHTML=`⏳ Analisando pixels: ${Math.round(m.progress*100)}%`;}});
    const text=res.data.text;
    const matches=text.match(/R\$?\s*(\d{1,4}[.,]\d{2})/gi);
    let val=0;
    if(matches&&matches.length){
      const amounts=matches.map(m=>parseFloat(m.replace(/[R$\s]/g,'').replace(',','.'))).filter(n=>!isNaN(n));
      if(amounts.length)val=Math.max(...amounts); // Get the biggest value found
    }else{
      const r=text.match(/\b(\d{1,3}[.,]\d{2})\b/g);
      if(r&&r.length)val=Math.max(...r.map(m=>parseFloat(m.replace(',','.'))));
    }
    if(val>0&&val<1500){
      const inp=$('input[name="amount"]');
      if(inp){inp.value=val;inp.dispatchEvent(new Event('input'));toast(`Mágica feita! Valor R$ ${val.toFixed(2).replace('.',',')} encontrado no print e preenchido! 🦊✨`);}
    }else toast('Não consegui ler um valor claro de corrida nessa imagem. Verifique o print.');
  }catch(err){console.error(err);toast('Erro ao processar a imagem. O print estava muito escuro ou o celular ficou sem memória.');}
  finally{if(btn){btn.innerHTML=btn.dataset.original;btn.disabled=false;}}
};
function closeForm(){if(dirty&&!confirm('Descartar as alterações ainda não salvas?'))return;dirty=false;$('#modal').close();}
async function reloadData(){
 if(saving)return;
 if(dirty&&!confirm('Recarregar e descartar as alterações deste formulário?'))return;
 try{await window.DriverApp.load();dirty=false;$('#modal').close();toast('Dados atualizados.');}
 catch(e){toast(e.message);}
}
function exportRaw(){if(loadedRaw)download(`capitalex-recuperacao-${dateKey()}.json`,loadedRaw,'application/json');}
async function recoverPrevious(){
 if(!cloudPrevious)return toast('Ainda não há uma versão anterior salva.');
 if(!confirm('Recuperar a versão anterior? A versão atual será preservada como cópia anterior.'))return;
 await commit(cloudPrevious,'Versão anterior recuperada.',true);
}
window.gerarCardWhatsApp = function(targetDate) {
  const date = targetDate || dateKey();
  const entries = state().entries.filter(e => e.date === date);
  const t = totals(entries);
  const goal = state().goals.daily || 300;
  const pctGoal = goal > 0 ? Math.round((t.net / goal) * 100) : 100;
  const d = new Date(date + 'T12:00:00');
  const weekDay = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const weekDayCap = weekDay.charAt(0).toUpperCase() + weekDay.slice(1);
  const dateFormatted = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const netKmStr = t.km ? money(t.net / t.km) + '/km' : '—';
  const netHrStr = t.hours ? money(t.net / t.hours) + '/h' : '—';
  const shareText = `🚗 *FECHAMENTO DO EXPEDIENTE • CAPITALEX DRIVER*\n📅 ${weekDayCap}, ${dateFormatted}\n\n💰 *Lucro Líquido Real:* ${money(t.net)}\n🟢 *Ganhos Brutos:* ${money(t.income)} (${t.count} corrida${t.count===1?'':'s'})\n🔴 *Despesas Pagas:* ${money(t.expense)}\n⚡ *Rendimento por KM:* ${netKmStr} (${number(t.km)} km)\n⏱️ *Rendimento por Hora:* ${netHrStr} (${number(t.hours)} h)\n🎯 *Meta do Dia:* ${pctGoal}% ${t.net >= goal ? 'BATIDA! 🔥' : 'concluída'}\n\nControle seus lucros no *Capitalex Driver*\n👉 https://capitalexdriver.com`;

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  const rRect = (x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };

  const bgGrad = ctx.createLinearGradient(0, 0, 1080, 1080);
  bgGrad.addColorStop(0, '#061320');
  bgGrad.addColorStop(0.5, '#0a1d30');
  bgGrad.addColorStop(1, '#05121c');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1080, 1080);

  const glow = ctx.createRadialGradient(540, 260, 20, 540, 260, 500);
  glow.addColorStop(0, 'rgba(52, 214, 172, 0.16)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.strokeStyle = '#1a3754';
  ctx.lineWidth = 4;
  rRect(40, 40, 1000, 1000, 32);
  ctx.stroke();

  ctx.fillStyle = '#34d6ac';
  ctx.font = '800 32px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText('CAPITALEX DRIVER', 80, 110);

  ctx.fillStyle = '#849fb8';
  ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText('SEU TRABALHO • SEUS RESULTADOS REAIS', 80, 140);

  ctx.fillStyle = 'rgba(52, 214, 172, 0.16)';
  rRect(700, 75, 300, 48, 24);
  ctx.fill();
  ctx.strokeStyle = '#34d6ac';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#34d6ac';
  ctx.font = '800 17px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚡ FECHAMENTO DO DIA', 850, 106);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`${weekDayCap.toUpperCase()} • ${dateFormatted}`, 80, 200);

  ctx.fillStyle = 'rgba(12, 29, 46, 0.88)';
  rRect(80, 230, 920, 240, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(52, 214, 172, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 18px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText('LUCRO LÍQUIDO REAL DO EXPEDIENTE', 120, 280);

  ctx.fillStyle = t.net >= 0 ? '#34d6ac' : '#ffb1a7';
  ctx.font = '800 68px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText(money(t.net), 120, 365);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Ganhos brutos menos combustível e despesas pagas', 120, 415);

  const drawCard = (x, y, w, h, icon, label, val, sub, valCol) => {
    ctx.fillStyle = 'rgba(10, 23, 38, 0.78)';
    rRect(x, y, w, h, 18);
    ctx.fill();
    ctx.strokeStyle = '#1d3a57';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#849fb8';
    ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${icon} ${label}`, x + 24, y + 42);

    ctx.fillStyle = valCol;
    ctx.font = '800 34px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillText(val, x + 24, y + 92);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillText(sub, x + 24, y + 130);
  };

  drawCard(80, 500, 445, 160, '🟢', 'GANHOS BRUTOS', money(t.income), `${t.count} corrida${t.count===1?'':'s'} registrada${t.count===1?'':'s'}`, '#38bdf8');
  drawCard(555, 500, 445, 160, '🔴', 'DESPESAS PAGAS', money(t.expense), 'Combustível e gastos do dia', '#fb923c');
  drawCard(80, 685, 445, 160, '⚡', 'RENDIMENTO / KM', netKmStr, `${number(t.km)} km rodados`, '#34d6ac');
  drawCard(555, 685, 445, 160, '⏱️', 'RENDIMENTO / HORA', netHrStr, `${number(t.hours)} h trabalhadas`, '#34d6ac');

  ctx.fillStyle = pctGoal >= 100 ? 'rgba(52, 214, 172, 0.16)' : 'rgba(56, 189, 248, 0.12)';
  rRect(80, 875, 920, 65, 16);
  ctx.fill();
  ctx.strokeStyle = pctGoal >= 100 ? '#34d6ac' : '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = pctGoal >= 100 ? '#34d6ac' : '#38bdf8';
  ctx.font = '800 20px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`🎯 META DO DIA: ${money(goal)}  •  ${pctGoal}% ${pctGoal >= 100 ? 'ALCANÇADA COM SUCESSO! 🔥' : 'CONCLUÍDA'}`, 110, 916);

  ctx.fillStyle = '#64748b';
  ctx.font = '600 17px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.fillText('capitalexdriver.com • Pare de adivinhar o seu lucro.', 80, 995);

  ctx.fillStyle = '#34d6ac';
  ctx.font = '700 17px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Baixe o app no celular 📱', 1000, 995);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  const previewBox = document.getElementById('sharePreviewContainer');
  if (previewBox) {
    previewBox.innerHTML = `
      <img src="${dataUrl}" alt="Cartão do Dia" style="border:1px solid #1e3d5b;">
    `;
  }

  const btnShare = document.getElementById('btnShareWhatsAppAction');
  const btnDownload = document.getElementById('btnDownloadCardAction');
  const btnCopy = document.getElementById('btnCopyTextAction');

  canvas.toBlob(blob => {
    if (btnDownload) {
      btnDownload.onclick = () => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `fechamento-capitalex-${date}.png`;
        a.click();
      };
    }

    if (btnShare) {
      btnShare.onclick = async () => {
        if (blob && navigator.canShare) {
          const file = new File([blob], `fechamento-${date}.png`, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: 'Meu Fechamento • Capitalex Driver',
                text: shareText
              });
              return;
            } catch (err) {
              if (err.name === 'AbortError') return;
            }
          }
        }
        window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(shareText), '_blank');
      };
    }
  });

  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(shareText);
      if (window.toast) window.toast('Texto formatado copiado! Cole no seu grupo de WhatsApp.');
      else alert('Texto copiado com sucesso!');
    };
  }

  const modal = document.getElementById('shareModal');
  if (modal) {
    if (!modal.dataset.backdropBound) {
      modal.dataset.backdropBound = 'true';
      modal.addEventListener('click', (e) => {
        const rect = modal.getBoundingClientRect();
        const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
        if (!isInDialog) modal.close();
      });
    }
    modal.showModal();
  }
};

window.toggleVehicleTypeCfg = function(type) {
  const r = document.getElementById('cfgRentBlock');
  const o = document.getElementById('cfgOwnBlock');
  if (r) r.style.display = type === 'rent' ? 'block' : 'none';
  if (o) o.style.display = type === 'rent' ? 'none' : 'block';
};

window.resetMaintenance = async function(type) {
  const s = state();
  const odo = Number(s.profile.odometer) || 0;
  const next = JSON.parse(JSON.stringify(s));
  let label = '';
  if (type === 'oil') { next.profile.oilChangeKm = odo + 10000; label = 'Troca de óleo e filtro (+10.000 km)'; }
  if (type === 'brakes') { next.profile.brakesKm = odo + 30000; label = 'Pastilhas de freio (+30.000 km)'; }
  if (type === 'tires') { next.profile.tiresKm = odo + 10000; label = 'Rodízio de pneus (+10.000 km)'; }
  await commit(next, `✅ ${label} renovada com sucesso a partir de ${number(odo)} km!`);
};

window.quickFillFuel = function(val) {
  const cat = document.querySelector('select[name=category]');
  const amt = document.querySelector('input[name=amount]');
  const desc = document.querySelector('input[name=description]');
  if (cat) cat.value = 'Combustível';
  if (amt) { amt.value = Number(val).toFixed(2); amt.dispatchEvent(new Event('input')); }
  if (desc && (!desc.value || desc.value === 'Abastecimento')) desc.value = `Abastecimento R$ ${val}`;
  if (window.toast) window.toast(`⛽ Abastecimento de R$ ${val} preenchido! Clique em Salvar.`);
};

window.quickFillFood = function(val) {
  const cat = document.querySelector('select[name=category]');
  const amt = document.querySelector('input[name=amount]');
  const desc = document.querySelector('input[name=description]');
  if (cat) cat.value = 'Alimentação';
  if (amt) { amt.value = Number(val).toFixed(2); amt.dispatchEvent(new Event('input')); }
  if (desc && (!desc.value || desc.value === 'Alimentação / Lanche')) desc.value = `Alimentação R$ ${val}`;
  if (window.toast) window.toast(`🍔 Refeição de R$ ${val} preenchida! Clique em Salvar.`);
};

window.quickAddFuelDirect = function(val) {
  openForm('expense');
  setTimeout(() => window.quickFillFuel(val), 80);
};

window.DriverApp={
 async load(){
  const r=await window.Account.api('data');
  const data=r.data?parseBackup(JSON.stringify(r.data)):defaults();
  saved=data;cloudRevision=r.revision;cloudPrevious=r.previous;loadedRaw=JSON.stringify(data);storageIssue='';tabConflict=false;demo=null;render();
  setTimeout(checkOnboardingInitial, 600);
 },
 clear(){saved=defaults();cloudRevision=0;cloudPrevious=null;loadedRaw=null;demo=null;dirty=false;$('#modal')?.close();render();}
};

function checkOnboardingInitial() {
  if (window.CapitalexSession?.billing?.active && saved.entries.length === 0 && !localStorage.getItem('capitalex_onboarding_done')) {
    window.openOnboardingWizard();
  }
}

window.openOnboardingWizard = function() {
  let modal = document.getElementById('onboardingDialog');
  if (!modal) {
    modal = document.createElement('dialog');
    modal.id = 'onboardingDialog';
    modal.style.cssText = 'border: 1px solid #34d6ac; border-radius: 20px; background: #0b1a29; color: #fff; padding: 24px; max-width: 440px; width: 92%; box-shadow: 0 16px 50px rgba(0,0,0,0.8); margin: auto;';
    document.body.appendChild(modal);
  }

  let step = 1;
  const data = {
    vehicle: '',
    consumption: 11.5,
    isRent: false,
    rentWeekly: 550,
    grossIncome: 280,
    kmDriven: 130,
    fuelExpense: 80
  };

  function renderStep() {
    if (step === 1) {
      modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <span style="font-size:11px; font-weight:800; color:#34d6ac; text-transform:uppercase; letter-spacing:0.8px;">Passo 1 de 3 • Seu Veículo</span>
          <button type="button" class="icon-button" onclick="document.getElementById('onboardingDialog').close()" style="color:#94a3b8; font-size:18px;">✕</button>
        </div>
        <h2 style="font-size:1.3rem; font-weight:800; margin:0 0 6px; color:#fff;">Qual carro você usa no dia a dia?</h2>
        <p style="font-size:0.85rem; color:#94a3b8; margin:0 0 16px;">Vamos calibrar o cálculo de combustível e custos por km.</p>
        
        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:#cbd5e1;">Modelo do Carro</label>
        <input type="text" id="obVehicle" placeholder="Ex: Onix 1.0 Flex, HB20, Kwid..." value="${data.vehicle}" style="width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid #1f3b55; background:#060e18; color:#fff; font-size:0.95rem; margin-bottom:14px;">

        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:#cbd5e1;">Média Estimada de Consumo (KM/L)</label>
        <input type="number" step="0.1" id="obConsumption" value="${data.consumption}" style="width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid #1f3b55; background:#060e18; color:#fff; font-size:0.95rem; margin-bottom:8px;">
        
        <div style="display:flex; gap:6px; margin-bottom:20px; flex-wrap:wrap;">
          <button type="button" class="ghost" onclick="document.getElementById('obConsumption').value='9.5'" style="font-size:11px; padding:6px 10px;">Etanol (9.5)</button>
          <button type="button" class="ghost" onclick="document.getElementById('obConsumption').value='12.0'" style="font-size:11px; padding:6px 10px;">Gasolina (12.0)</button>
          <button type="button" class="ghost" onclick="document.getElementById('obConsumption').value='14.0'" style="font-size:11px; padding:6px 10px;">GNV/Econômico (14.0)</button>
        </div>

        <button type="button" id="btnObNext1" class="primary" style="width:100%; padding:14px; font-size:1rem; font-weight:800; border-radius:12px; background:#34d6ac; color:#081320; border:none; cursor:pointer;">
          Continuar (1/3) →
        </button>
      `;
      document.getElementById('btnObNext1').onclick = () => {
        data.vehicle = document.getElementById('obVehicle').value.trim() || 'Meu Carro';
        data.consumption = parseFloat(document.getElementById('obConsumption').value) || 11.5;
        step = 2;
        renderStep();
      };
    } else if (step === 2) {
      modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <span style="font-size:11px; font-weight:800; color:#34d6ac; text-transform:uppercase; letter-spacing:0.8px;">Passo 2 de 3 • Tipo de Uso</span>
          <button type="button" class="icon-button" onclick="document.getElementById('onboardingDialog').close()" style="color:#94a3b8; font-size:18px;">✕</button>
        </div>
        <h2 style="font-size:1.3rem; font-weight:800; margin:0 0 6px; color:#fff;">O carro é próprio ou alugado?</h2>
        <p style="font-size:0.85rem; color:#94a3b8; margin:0 0 16px;">Isso muda a forma como o app calcula sua diária e provisões.</p>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
          <div id="cardProprio" onclick="selectCarType(false)" style="border: 2px solid ${!data.isRent ? '#34d6ac' : '#1f3b55'}; background: ${!data.isRent ? 'rgba(52,214,172,0.1)' : '#060e18'}; border-radius:12px; padding:14px 10px; text-align:center; cursor:pointer;">
            <div style="font-size:24px; margin-bottom:4px;">🏠</div>
            <strong style="font-size:13px; color:#fff; display:block;">Carro Próprio</strong>
            <small style="font-size:11px; color:#94a3b8;">Com reserva mecânica</small>
          </div>
          <div id="cardAlugado" onclick="selectCarType(true)" style="border: 2px solid ${data.isRent ? '#34d6ac' : '#1f3b55'}; background: ${data.isRent ? 'rgba(52,214,172,0.1)' : '#060e18'}; border-radius:12px; padding:14px 10px; text-align:center; cursor:pointer;">
            <div style="font-size:24px; margin-bottom:4px;">🏢</div>
            <strong style="font-size:13px; color:#fff; display:block;">Alugado</strong>
            <small style="font-size:11px; color:#94a3b8;">Localiza, Kovi, etc.</small>
          </div>
        </div>

        <div id="rentFieldBox" style="display:${data.isRent ? 'block' : 'none'}; margin-bottom:16px; background:#060e18; padding:12px; border-radius:10px; border:1px solid #1f3b55;">
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:#cbd5e1;">Valor do Aluguel por Semana (R$)</label>
          <input type="number" id="obRentWeekly" value="${data.rentWeekly}" style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid #2b5074; background:#0b1a29; color:#fff; font-size:0.95rem;">
        </div>

        <div style="display:flex; gap:8px;">
          <button type="button" class="ghost" onclick="step=1; renderStep();" style="flex:1; padding:13px; font-size:0.95rem; border-radius:12px;">← Voltar</button>
          <button type="button" id="btnObNext2" class="primary" style="flex:2; padding:13px; font-size:0.95rem; font-weight:800; border-radius:12px; background:#34d6ac; color:#081320; border:none; cursor:pointer;">Continuar (2/3) →</button>
        </div>
      `;
      window.selectCarType = function(isRent) {
        data.isRent = isRent;
        renderStep();
      };
      document.getElementById('btnObNext2').onclick = () => {
        if (data.isRent) {
          data.rentWeekly = parseFloat(document.getElementById('obRentWeekly')?.value) || 550;
        }
        step = 3;
        renderStep();
      };
    } else if (step === 3) {
      modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <span style="font-size:11px; font-weight:800; color:#34d6ac; text-transform:uppercase; letter-spacing:0.8px;">Passo 3 de 3 • Primeira Vitória</span>
          <button type="button" class="icon-button" onclick="document.getElementById('onboardingDialog').close()" style="color:#94a3b8; font-size:18px;">✕</button>
        </div>
        <h2 style="font-size:1.3rem; font-weight:800; margin:0 0 6px; color:#fff;">Quanto você faturou hoje ou ontem?</h2>
        <p style="font-size:0.85rem; color:#94a3b8; margin:0 0 16px;">Lance uma estimativa para ver seu gráfico e lucro líquido nascerem na hora!</p>

        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:#cbd5e1;">Faturamento Bruto Total (Uber + 99)</label>
        <input type="number" id="obGross" value="${data.grossIncome}" style="width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid #1f3b55; background:#060e18; color:#34d6ac; font-size:1.25rem; font-weight:800; font-family:monospace; margin-bottom:12px;">

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px;">
          <div>
            <label style="display:block; font-size:11px; font-weight:700; margin-bottom:4px; color:#cbd5e1;">KM Rodados</label>
            <input type="number" id="obKm" value="${data.kmDriven}" style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid #1f3b55; background:#060e18; color:#fff; font-size:0.95rem;">
          </div>
          <div>
            <label style="display:block; font-size:11px; font-weight:700; margin-bottom:4px; color:#cbd5e1;">Combustível Gasto</label>
            <input type="number" id="obFuel" value="${data.fuelExpense}" style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid #1f3b55; background:#060e18; color:#f87171; font-size:0.95rem;">
          </div>
        </div>

        <button type="button" id="btnObFinish" class="primary" style="width:100%; padding:15px; font-size:1rem; font-weight:800; border-radius:12px; background:linear-gradient(135deg, #34d6ac, #059669); color:#081320; border:none; cursor:pointer; box-shadow:0 6px 20px rgba(52,214,172,0.3);">
          🚀 Concluir e Ver Meu Lucro Real!
        </button>
      `;
      document.getElementById('btnObFinish').onclick = async () => {
        data.grossIncome = parseFloat(document.getElementById('obGross').value) || 280;
        data.kmDriven = parseFloat(document.getElementById('obKm').value) || 130;
        data.fuelExpense = parseFloat(document.getElementById('obFuel').value) || 80;

        const next = JSON.parse(JSON.stringify(state()));
        next.profile.vehicle = data.vehicle || 'Meu Veículo';
        next.profile.consumption = data.consumption || 11.5;
        if (data.isRent) {
          next.profile.isRent = true;
          next.profile.rentAmount = data.rentWeekly;
          next.profile.rentWorkDays = 6;
          next.profile.rentDaily = Math.round(data.rentWeekly / 6);
        }

        const today = dateKey();
        next.entries.push({
          id: uid(),
          date: today,
          amount: data.grossIncome,
          description: 'Lançamento Inicial de Trabalho',
          type: 'income',
          mode: 'daily',
          km: data.kmDriven,
          hours: 8,
          count: Math.max(1, Math.round(data.kmDriven / 12)),
          app: 'Todos',
          breakdown: { Uber: data.grossIncome }
        });

        if (data.fuelExpense > 0) {
          next.entries.push({
            id: uid(),
            date: today,
            amount: data.fuelExpense,
            description: 'Abastecimento Inicial',
            type: 'expense',
            category: 'Combustível'
          });
        }

        localStorage.setItem('capitalex_onboarding_done', 'true');
        modal.close();
        await commit(next, '🎉 Parabéns! Seus dados foram configurados e seu lucro real já está na tela!');
      };
    }
  }

  renderStep();
  modal.showModal();
};

window.gerarComprovanteRendaPDF = function() {
  const s = state();
  const es = selected();
  const t = totals(es);
  const userEmail = window.CapitalexSession?.email || 'Motorista Parceiro';
  const vehicle = s.profile.vehicle || 'Veículo Cadastrado';
  const now = new Date();
  const periodText = document.getElementById('periodLabel')?.textContent || 'Período Selecionado';
  
  const byApp = {};
  es.filter(e => e.type === 'income').forEach(e => {
    if (e.mode === 'daily' && e.breakdown) {
      Object.entries(e.breakdown).forEach(([k, v]) => byApp[k] = (byApp[k] || 0) + v);
    } else {
      byApp[e.app || 'Geral'] = (byApp[e.app || 'Geral'] || 0) + e.amount;
    }
  });

  const byCat = {};
  es.filter(e => e.type === 'expense').forEach(e => {
    const cat = e.category || 'Outros';
    byCat[cat] = (byCat[cat] || 0) + e.amount;
  });

  const hashDoc = 'CD-' + Math.random().toString(36).substring(2, 9).toUpperCase() + '-' + now.getFullYear();

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Por favor, permita pop-ups no seu navegador para emitir o comprovante.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>Comprovante de Rendimentos - Capitalex Driver</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 30px; line-height: 1.5; font-size: 14px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px; }
        .logo-title { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
        .logo-sub { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .doc-badge { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-align: right; }
        .grid-info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 24px; font-size: 13px; }
        .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #334155; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
        th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; font-weight: 700; color: #475569; }
        .text-right { text-align: right; }
        .font-mono { font-family: monospace; font-size: 14px; }
        .highlight-box { background: #ecfdf5; border: 2px solid #10b981; border-radius: 8px; padding: 16px; margin: 24px 0; text-align: center; }
        .highlight-title { font-size: 12px; font-weight: 800; text-transform: uppercase; color: #047857; letter-spacing: 0.8px; }
        .highlight-value { font-size: 28px; font-weight: 900; color: #065f46; margin: 4px 0; font-family: monospace; }
        .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; align-items: center; }
        .print-btn-bar { margin-bottom: 20px; padding: 12px; background: #0f172a; color: #fff; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
        .btn-print { background: #10b981; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; }
        @media print {
          .print-btn-bar { display: none !important; }
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="print-btn-bar">
        <span>📄 <strong>Comprovante Gerencial de Rendimentos</strong> pronto para impressão</span>
        <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
      </div>

      <div class="header">
        <div>
          <div class="logo-title">CAPITALEX DRIVER</div>
          <div class="logo-sub">Gestão Financeira e Telemetria para Transporte por Aplicativo</div>
        </div>
        <div class="doc-badge">
          <div>DOCUMENTO Nº: <span style="font-family:monospace">${hashDoc}</span></div>
          <div style="color:#64748b; font-weight:normal;">Emissão: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</div>
        </div>
      </div>

      <div class="grid-info">
        <div><strong>Titular / Motorista:</strong> ${userEmail}</div>
        <div><strong>Veículo Operacional:</strong> ${vehicle}</div>
        <div><strong>Período de Apuração:</strong> ${periodText}</div>
        <div><strong>Quilometragem Percorrida:</strong> ${t.km.toLocaleString('pt-BR')} km</div>
      </div>

      <div class="section-title">1. Discriminação dos Ganhos Brutos por Plataforma</div>
      <table>
        <thead>
          <tr><th>Plataforma / Origem</th><th class="text-right">Valor Recebido</th></tr>
        </thead>
        <tbody>
          ${Object.entries(byApp).map(([app, val]) => `<tr><td>${app}</td><td class="text-right font-mono">${money(val)}</td></tr>`).join('')}
          <tr style="font-weight: 800; background: #f8fafc;"><td>TOTAL FATURAMENTO BRUTO</td><td class="text-right font-mono">${money(t.income)}</td></tr>
        </tbody>
      </table>

      <div class="section-title">2. Despesas e Custos Operacionais Comprovados</div>
      <table>
        <thead>
          <tr><th>Categoria da Despesa</th><th class="text-right">Valor Gasto</th></tr>
        </thead>
        <tbody>
          ${Object.keys(byCat).length ? Object.entries(byCat).map(([cat, val]) => `<tr><td>${cat}</td><td class="text-right font-mono" style="color:#b91c1c;">- ${money(val)}</td></tr>`).join('') : '<tr><td colspan="2">Nenhuma despesa registrada no período.</td></tr>'}
          <tr style="font-weight: 800; background: #f8fafc;"><td>TOTAL DE CUSTOS OPERACIONAIS</td><td class="text-right font-mono" style="color:#b91c1c;">- ${money(t.expense)}</td></tr>
        </tbody>
      </table>

      <div class="highlight-box">
        <div class="highlight-title">Rendimento Líquido Efetivo (Lucro Real no Bolso)</div>
        <div class="highlight-value">${money(t.net)}</div>
        <div style="font-size:12px; color:#047857;">Margem Operacional Líquida: <strong>${t.income ? (t.net / t.income * 100).toFixed(1) + '%' : '100%'}</strong></div>
      </div>

      <div class="footer">
        <div style="max-width: 72%;">
          <strong>Declaração Gerencial Informativa:</strong> Emitido automaticamente via Capitalex Driver com base exclusivamente nos lançamentos operacionais declarados pelo próprio motorista. Documento utilitário para auxílio de controle gerencial e comprovação de rotina; não substitui demonstrativos contábeis com fé pública nem declarações oficiais à Receita Federal do Brasil. Uber, 99 e inDrive são marcas registradas de seus respectivos proprietários.
        </div>
        <div style="text-align:right;">
          Chave de Autenticidade:<br>
          <strong style="font-family:monospace;">${hashDoc}</strong>
        </div>
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();
};

window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
if(localStorage.getItem('capitalex_theme')!=='dark')document.documentElement.classList.add('light-theme');
function navigate(){route=location.hash.slice(1);if(!paths[route])route='dashboard';render();}window.addEventListener('hashchange',navigate);navigate();

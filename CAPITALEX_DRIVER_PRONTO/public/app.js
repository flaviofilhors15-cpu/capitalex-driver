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
const ALLOWED_APPS=['Uber','99','inDrive','Particular','Outros'];
const ALLOWED_CATEGORIES=['Combustível','Alimentação','Manutenção','Seguro','Aluguel do veículo','Parcela do veículo','Celular','Pedágio','Estacionamento','Impostos e taxas','Outros'];
let cloudRevision=0, cloudPrevious=null, saving=false;
const state=()=>demo||saved;
const paths={dashboard:['Visão geral','O resultado do seu trabalho, sem complicação.','M3 10l9-7 9 7v10H3z M9 20v-7h6v7'],corridas:['Ganhos e corridas','Registre cada corrida ou o total do dia.','M4 16h16l-2-8H6z M7 16v3 M17 16v3 M7 12h10'],gastos:['Despesas','Entenda o que pesa no seu resultado.','M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6'],calculadora:['Calculadora','Raio-X da corrida antes de aceitar','M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z M16 2v4 M8 2v4 M3 10h18 M9 15h6'],veiculo:['Meu veículo','Quilometragem e manutenção sob controle.','M4 16h16l-2-8H6z M7 16v3 M17 16v3'],investimentos:['Caixinhas e Objetivos','Dinheiro separado para os seus projetos.','M12 3v18 M17 7H9a3 3 0 000 6h6a3 3 0 010 6H6'],relatorios:['Relatórios','Compare os resultados do período selecionado.','M4 20V10 M10 20V4 M16 20v-8 M22 20H2'],metas:['Minhas metas','Objetivos claros para trabalhar com direção.','M21 12a9 9 0 11-9-9 M12 8a4 4 0 104 4 M12 12l9-9 M16 3h5v5'],perfil:['Perfil e backup','Seus dados, preferências e cópias de segurança.','M16 7a4 4 0 11-8 0 4 4 0 018 0 M4 21v-3a8 8 0 0116 0v3']};
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00:00'))&&dateKey(new Date(s+'T12:00:00'))===s;}
function finite(n,min=0){return typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=1e9;}
function validBackup(s){
 try{
  const text=(v,max,empty=true)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0);
  const amount=v=>finite(v,.01)&&v<=1e7&&Math.abs(v*100-Math.round(v*100))<.0001;
  const entry=e=>e&&text(e.id,100,false)&&validDate(e.date)&&e.date>='2000-01-01'&&e.date<=dateKey()&&amount(e.amount)&&text(e.description,160)&&(['income','expense'].includes(e.type))&&(e.type==='expense'?ALLOWED_CATEGORIES.includes(e.category):(['daily','ride'].includes(e.mode)&&finite(e.km)&&e.km<=100000&&finite(e.hours)&&e.hours<=24&&Number.isInteger(e.count)&&e.count>=0&&e.count<=10000&&(e.mode==='ride'?(ALLOWED_APPS.includes(e.app)&&e.count===1):e.app==='Todos')&&(!e.breakdown||(e.mode==='daily'&&typeof e.breakdown==='object'&&!Array.isArray(e.breakdown)&&Object.keys(e.breakdown).every(k=>ALLOWED_APPS.includes(k))&&Object.values(e.breakdown).every(v=>finite(v)&&v<=1e7&&Math.abs(v*100-Math.round(v*100))<.0001)&&Math.abs(Object.values(e.breakdown).reduce((a,b)=>a+b,0)-e.amount)<.001))));
  const fund=f=>f&&text(f.id,100,false)&&validDate(f.date)&&f.date>='2000-01-01'&&f.date<=dateKey()&&text(f.name,100,false)&&amount(f.amount);
  if(!s||s.version!==2||!s.profile||!text(s.profile.name,60)||!text(s.profile.vehicle,100)||!['odometer','serviceAt','consumption'].every(k=>finite(s.profile[k]))||s.profile.consumption>100||s.profile.odometer>1e7||s.profile.serviceAt>1e7||!s.goals||!['daily','monthly','reserve'].every(k=>amount(s.goals[k]))||!finite(s.reservePerKm)||s.reservePerKm>100||!Array.isArray(s.entries)||s.entries.length>50000||!s.entries.every(entry)||!Array.isArray(s.funds)||s.funds.length>10000||!s.funds.every(fund))return false;
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
function cards(t){return `<div class="cards">${card('Ganhos recebidos',money(t.income),`${number(t.count)} corridas registradas`)}${card('Despesas pagas',money(t.expense),'Todos os gastos lançados')}${card('Saldo do período',money(t.net),'Ganhos menos despesas pagas',true)}${card('Rendimento Líquido',t.km?money(t.net/t.km)+'/km':'—',t.hours?money(t.net/t.hours)+'/hora • '+number(t.km)+' km totais':'Registre KM e Horas na corrida')}</div>`;}
function table(entries){if(!entries.length)return empty('Seu histórico começa aqui','Registre um ganho ou uma despesa para acompanhar a evolução.');return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Lançamento</th><th>Detalhes</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${[...entries].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<tr><td>${displayDate(e.date)}</td><td>${esc(e.type==='income'?(e.mode==='daily'?'Fechamento do dia':e.app):e.category)}<br><small>${esc(e.description)}</small></td><td>${e.type==='income'?`${number(e.count)} corridas · ${number(e.km)} km<br><small>${number(e.hours)} h registradas</small>`:'<span class="tag">Despesa</span>'}</td><td class="${e.type==='income'?'positive':'negative'}">${e.type==='income'?'+':'−'} ${money(e.amount)}</td><td><button data-edit="${esc(e.id)}" aria-label="Editar lançamento de ${displayDate(e.date)}">Editar</button> <button data-delete="${esc(e.id)}" class="ghost danger" aria-label="Excluir lançamento de ${displayDate(e.date)}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`;}
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
  return `<div class="legend"><span><i style="background:#43a6ff"></i>Ganhos</span><span><i style="background:#ffb46b"></i>Despesas</span><span><i style="background:#34d6ac"></i>Saldo</span></div><div style="height:250px;width:100%;position:relative;margin-top:10px;"><canvas id="${id}"></canvas></div><details class="chart-details"><summary>Ver valores do gráfico por ${group}</summary><div class="table-wrap"><table><thead><tr><th>Período</th><th>Ganhos</th><th>Despesas</th><th>Saldo</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.label}</td><td>${money(p.income)}</td><td>${money(p.expense)}</td><td>${money(p.net)}</td></tr>`).join('')}</tbody></table></div></details>`;
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
function goalPanel(title,actual,target,note){const pct=target>0?Math.max(0,actual/target*100):100;return `<h2>${title}</h2><p class="muted">${money(actual)} de ${money(target)}</p><div class="metric">${number(pct)}%</div><progress max="100" value="${Math.min(100,pct)}" aria-label="${esc(title)}"></progress><p>${actual>=target?'Objetivo alcançado. Bom trabalho!':`Faltam <strong>${money(target-actual)}</strong>`}</p><small>${note}</small>`;}
 function dashboard(){
  const t=totals(selected()),today=totals(state().entries.filter(e=>e.date===dateKey())),reserve=round(t.km*state().reservePerKm);
  const p=state().profile;let alertHtml='';
  if(p.serviceAt&&p.odometer){
    const left=p.serviceAt-p.odometer;
    if(left<=0) alertHtml=`<div class="card feature" style="background:linear-gradient(135deg,#5e1c29,#380e15);border-color:#a1263c;color:#ffb1a7;margin-bottom:16px;"><strong>🚨 Troca de Óleo / Revisão Atrasada!</strong><p style="margin:4px 0 0;font-size:14px;color:#fbb">Você já passou ${number(-left)} km da meta. Agende a manutenção na aba Veículo!</p></div>`;
    else if(left<=500) alertHtml=`<div class="card feature" style="background:linear-gradient(135deg,#523512,#2b1a07);border-color:#8a5a1f;color:#ffb46b;margin-bottom:16px;"><strong>⚠️ Atenção à Manutenção!</strong><p style="margin:4px 0 0;font-size:14px;color:#fcdcb8">Faltam apenas ${number(left)} km para a sua próxima revisão.</p></div>`;
  }
  return `${alertHtml}${cards(t)}<div class="split"><section class="panel"><div class="panel-head"><div><h2>Ritmo da semana</h2><p>7 dias até a data final do período • valores em R$</p></div><span class="tag">7 DIAS</span></div>${chart()}</section><section class="panel">${goalPanel('Sua meta de hoje',today.net,state().goals.daily,'Meta sobre o saldo, antes das reservas estimadas.')}<div class="actions" style="margin-top:20px"><button class="primary" data-action="income">🚗 Nova Corrida</button><button class="ghost" data-action="expense">⛽ Novo Gasto</button><button class="ghost" data-action="daily">⚡ Fechar Dia</button></div></section></div><section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Para onde foi o dinheiro</h2><p>Despesas do período, por categoria</p></div><a href="#gastos" class="positive">Ver despesas</a></div>${donut()}</section><div class="split"><section class="panel"><div class="panel-head"><h2>Últimos lançamentos</h2><a href="#corridas" class="positive">Ver ganhos</a></div>${table([...selected()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5))}</section><section class="panel"><h2>Olhar para o próximo mês</h2><p class="muted">Provisão estimada para o desgaste do carro.</p><div class="list-row"><span>Reserva sugerida</span><strong>${money(reserve)}</strong></div><div class="list-row"><span>Saldo após provisão</span><strong class="positive">${money(t.net-reserve)}</strong></div><p class="notice">Estimativa de ${money(state().reservePerKm)} por km. Não movimenta dinheiro e não é uma despesa paga. Ajuste em Veículo.</p></section></div>`;
 }
function gains(){return `<section class="panel"><div class="panel-head"><div><h2>Seu trabalho registrado</h2><p>Escolha corridas individuais ou um fechamento completo por dia.</p></div><div class="actions"><button class="primary" data-action="daily">Fechar dia</button></div></div><p class="notice">O fechamento soma todos os aplicativos. Para evitar duplicidade, um dia com corridas individuais não aceita fechamento até que esses registros sejam removidos.</p>${table(selected().filter(e=>e.type==='income'))}</section>`;}
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
function vehicle(){const p=state().profile,left=p.serviceAt-p.odometer;
const ipvaStr = p.ipva ? (new Date(p.ipva) < new Date() ? 'Vencido' : displayDate(p.ipva)) : 'Não definido';
const segStr = p.seguro ? (new Date(p.seguro) < new Date() ? 'Vencido' : displayDate(p.seguro)) : 'Não definido';
return `<div class="cards">${card('Veículo',esc(p.vehicle)||'Não informado','Cadastre seu modelo')}${card('Hodômetro',number(p.odometer)+' km','Atualização manual')}${card('Próxima revisão',p.serviceAt?(left<=0?'Revisão pendente':number(left)+' km'):'Não definida',p.serviceAt?'Alvo: '+number(p.serviceAt)+' km':'Defina o alvo',true)}${card('Vencimento IPVA',ipvaStr,'Imposto anual')}${card('Vencimento Seguro',segStr,'Proteção do veículo')}</div><section class="panel"><h2>Planejamento do veículo</h2><p class="muted">Atualize a quilometragem e as datas de vencimento dos documentos.</p><div class="actions"><button data-action="vehicle" class="primary">Editar veículo</button><button data-action="expense">Registrar manutenção</button></div><p class="notice">Reserva atual: ${money(state().reservePerKm)}/km. A provisão é apenas planejamento. IPVA e Manutenções devem ser registrados em Despesas quando pagos.</p><h3>Manutenções registradas no período</h3>${table(selected().filter(e=>e.type==='expense'&&e.category==='Manutenção'))}</section>`;}
function funds(){const s=state(),eRes=s.funds.filter(f=>f.name==='Reserva de emergência').reduce((a,f)=>a+f.amount,0),fRes=s.funds.filter(f=>f.name==='Férias e 13º').reduce((a,f)=>a+f.amount,0),total=round(s.funds.reduce((a,f)=>a+f.amount,0)),outros=total-eRes-fRes;return `<div class="actions" style="margin-bottom:20px"><button class="primary" data-action="fund">+ Guardar dinheiro</button></div><div class="settings-grid"><section class="panel">${goalPanel('🛡️ Emergência',eRes,s.goals.reserve,'Para imprevistos e dias parados.')}</section><section class="panel">${goalPanel('🏖️ Férias e 13º',fRes,s.goals.reserve>0?s.goals.reserve/2:0,'O seu descanso merecido.')}</section><section class="panel">${goalPanel('📦 Outras Caixinhas',outros,0,'IPVA, Seguro, Pneu novo.')}</section></div><section class="panel" style="margin-top:20px"><h2>Extrato das Caixinhas</h2><p class="muted">Dinheiro separado para os seus objetivos.</p>${s.funds.length?`<div class="table-wrap"><table><thead><tr><th>Data / Caixinha</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${[...s.funds].reverse().map(f=>`<tr><td>${displayDate(f.date)}<br><strong>${esc(f.name)}</strong></td><td class="positive">${money(f.amount)}</td><td><button data-fund-edit="${esc(f.id)}">Editar</button> <button data-fund-delete="${esc(f.id)}" class="ghost danger">Excluir</button></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma caixinha criada','Toque em Guardar dinheiro para começar.')}</section>`;}
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

  return `${cards(t)}<section class="panel" style="margin-bottom:22px"><h2>Evolução do período</h2><p class="muted">Agrupamento automático por dia, mês ou ano • valores em R$</p>${chart(true)}</section><section class="panel" style="margin-bottom:22px"><h2>Fluxo do Dinheiro (Cascata)</h2><p class="muted">Veja exatamente como suas despesas reduzem o seu ganho.</p>${waterfallChart()}</section><div class="split"><section class="panel"><div class="panel-head"><h2>Resultado detalhado</h2><div class="actions"><button data-action="csv">Exportar CSV</button><button data-action="print">Imprimir / PDF</button></div></div>${[['Ganhos recebidos',money(t.income)],['Despesas pagas',money(t.expense)],['Saldo do período',money(t.net)],['Margem sobre os ganhos',t.income?number(t.net/t.income*100)+'%':'—'],['Ganho por km registrado',t.km?money(t.income/t.km):'—'],['Despesa por km registrado',t.km?money(t.expense/t.km):'—'],['Saldo por hora registrada',t.hours?money(t.net/t.hours):'—']].map(([k,v])=>`<div class="list-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}<p class="notice">Indicadores dependem dos dados informados. No fechamento, inclua espera e deslocamentos sem passageiro. Custos fixos e impostos só entram se registrados como despesas.</p></section><div><section class="panel" style="margin-bottom:20px"><h2>Ganhos por aplicativo</h2>${Object.keys(by).length?Object.entries(by).map(([k,v])=>`<div class="list-row"><span>${esc(k)}</span><strong>${money(v)}</strong></div>`).join(''):empty('Sem ganhos no período','Registre seus primeiros resultados.')}</section><section class="panel"><h2>Dias mais lucrativos</h2><p class="muted">Média de lucro líquido (ganhos - despesas) por dia da semana.</p>${weekHtml}</section></div></div>`;
}
function goals(){const s=state(),today=dateKey(),day=totals(s.entries.filter(e=>e.date===today)),month=totals(s.entries.filter(e=>e.date.slice(0,7)===today.slice(0,7)&&e.date<=today)),reserve=s.funds.reduce((n,f)=>n+f.amount,0);return `<div class="actions" style="margin-bottom:20px"><button class="primary" data-action="goals">Editar objetivos</button></div><div class="settings-grid"><section class="panel">${goalPanel('Meta diária',day.net,s.goals.daily,'Saldo de hoje, antes de provisões.')}</section><section class="panel">${goalPanel('Meta mensal',month.net,s.goals.monthly,'Saldo do mês atual, antes de provisões.')}</section><section class="panel">${goalPanel('Reserva financeira',reserve,s.goals.reserve,'Total de aportes registrados em Reservas.')}</section></div>`;}
function profile(){const trash=state().trash||[];return `<div class="settings-grid"><section class="panel"><h2>${esc(state().profile.name)||'Seu perfil'}</h2><p class="muted">Personalize a sua experiência.</p><div class="actions"><button data-action="profile" class="primary">Editar nome</button><button data-action="theme" class="ghost">🌓 Trocar Tema (Claro/Escuro)</button></div><p class="notice">Seus registros ficam vinculados à sua conta. Encerre a sessão em aparelhos compartilhados. Não cadastre dados de passageiros.</p></section><section class="panel"><h2>Backup e recuperação</h2><p class="muted">Faça o download dos seus dados por segurança ou quando for trocar de celular.</p><div class="actions"><button data-action="backup" class="primary" ${storageIssue&&!demo?'disabled':''}>Baixar backup</button><button data-action="import" ${demo?'disabled':''}>Restaurar arquivo</button><button data-action="recovery" ${demo?'disabled':''}>Recuperar versão anterior</button></div><p class="notice">A cada gravação, a versão anterior fica guardada na sua conta. Exporte também uma cópia própria dos registros.</p>${storageIssue?'<button data-action="raw">Exportar dados originais para recuperação</button>':''}</section><section class="panel full"><h2>Lixeira recuperável</h2><p class="muted">Exclusões ficam guardadas na sua conta e também entram no backup. Restaurar não duplica ganhos já existentes.</p>${trash.length?`<div class="table-wrap"><table><thead><tr><th>Excluído em</th><th>Registro</th><th>Valor</th><th>Ação</th></tr></thead><tbody>${[...trash].reverse().map(t=>`<tr><td>${displayDate(t.deletedAt)}</td><td>${esc(t.item.name||t.item.category||t.item.app)}<br><small>${displayDate(t.item.date)}</small></td><td>${money(t.item.amount)}</td><td><button data-restore="${esc(t.trashId)}">Restaurar</button></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhum registro excluído','Se você excluir um lançamento, poderá recuperá-lo aqui.')}</section><section class="panel"><h2>Seus dados e a privacidade</h2><p class="muted">Seus lançamentos são enviados ao servidor por conexão segura e ficam separados por conta. O pagamento é realizado diretamente via Pix de forma segura.</p><p class="notice">Os backups JSON contêm dados financeiros sem criptografia. Guarde-os em local protegido. Esta versão não substitui a proteção e a senha do seu aparelho.</p></section><section class="panel"><h2>Demonstração isolada</h2><p class="muted">Explore gráficos com dados fictícios sem misturá-los aos seus lançamentos.</p><button data-action="demo">${demo?'Sair da demonstração':'Explorar demonstração'}</button></section></div>`;}
function calculadora(){
  return `<div class="split">
    <section class="panel">
      <div class="panel-head">
        <div><h2>Simulador de Corrida</h2><p>Digite os dados da corrida oferecida na tela do app</p></div>
      </div>
      <div class="form-grid">
        ${input('calcVal','Valor da Corrida (R$)','','number','step="0.01" oninput="runCalc()" inputmode="decimal"')}
        ${input('calcKm','Distância Total (KM)','','number','step="0.1" oninput="runCalc()" inputmode="decimal"')}
        ${input('calcMin','Tempo Estimado (Minutos)','','number','step="1" oninput="runCalc()" inputmode="numeric"')}
        ${input('calcGas','Preço do Combustível (R$/L)',localStorage.getItem('cap_gas_price')||'5.80','number','step="0.01" oninput="runCalc()" inputmode="decimal"')}
      </div>
      <p class="notice full">Dica: Use para avaliar rapidamente viagens longas ou dinâmicas.</p>
    </section>
    <section class="panel" id="calcResults">
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;color:var(--muted);opacity:0.3;margin-bottom:16px;"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        <strong>Aguardando dados...</strong>
        <p>Preencha os campos para ver o raio-x do lucro e o veredito.</p>
      </div>
    </section>
  </div>`;
}
window.runCalc=()=>{
  const getV=n=>parseFloat($('input[name="'+n+'"]')?.value.replace(',','.'))||0;
  const v=getV('calcVal'),km=getV('calcKm'),min=getV('calcMin'),gas=getV('calcGas');
  if(!v||!km)return;
  if(gas)localStorage.setItem('cap_gas_price',gas);
  const p=state().profile,consumption=p.consumption||10,reserve=state().reservePerKm||0.15;
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
    <p class="notice" style="margin-top:16px;font-size:12.5px;">Cálculo baseado no seu veículo cadastrado fazendo ${number(consumption)} km/L e poupando ${money(reserve)} por km para manutenção.</p>
  `;
};
function render(){chartInitializers=[];if(window.Chart){const isLight=document.documentElement.classList.contains('light-theme');Chart.defaults.color=isLight?'#475569':'#94a3b8';Chart.defaults.borderColor=isLight?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.05)';}const page=paths[route]||paths.dashboard;$('#pageTitle').textContent=page[0];$('#subtitle').textContent=page[1];const hr=new Date().getHours();const salutation=hr<12?'BOM DIA':hr<18?'BOA TARDE':'BOA NOITE';$('#greeting').textContent=state().profile.name?`${salutation}, ${state().profile.name.toLocaleUpperCase('pt-BR')}`:'CONTROLE FINANCEIRO';$('#demoBanner').hidden=!demo;$('#demoBtn').textContent=demo?'Sair da demonstração':'Ver demonstração';$('.toolbar').hidden=['veiculo','metas','perfil','investimentos','calculadora'].includes(route);$('#customDates').hidden=period!=='custom';const b=bounds();$('#periodLabel').textContent=period==='all'?'Todo o histórico':`${displayDate(b[0])} a ${displayDate(b[1])}`;$('nav').innerHTML=Object.entries(paths).map(([key,v])=>`<a href="#${key}" class="${key===route?'active':''}" ${key===route?'aria-current="page"':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${v[2]}"/></svg>${({dashboard:'Visão geral',corridas:'Ganhos',gastos:'Despesas',calculadora:'Calculadora',veiculo:'Veículo',investimentos:'Reservas',relatorios:'Relatórios',metas:'Metas',perfil:'Perfil e backup'})[key]}</a>`).join('');document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(a=>{a.classList.toggle('active',a.dataset.tab===route);});renderSafety();$('#content').innerHTML=({dashboard,corridas:gains,gastos:expenses,calculadora,veiculo:vehicle,investimentos:funds,relatorios:reports,metas:goals,perfil:profile}[route]||dashboard)();chartInitializers.forEach(init=>init());const hasToday=state().entries.some(e=>e.date===dateKey());$('#mobileQuickAdd')?.classList.toggle('pulse',!hasToday);}
function input(name,label,value='',type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function select(name,label,options,value){return `<label>${label}<select name="${name}">${options.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;}
const categories=['Combustível','Alimentação','Manutenção','Seguro','Aluguel do veículo','Parcela do veículo','Celular','Pedágio','Estacionamento','Impostos e taxas','Outros'];
function openForm(type,id){const s=state(),e=s.entries.find(e=>e.id===id)||s.funds.find(e=>e.id===id)||{};formContext={type,id};dirty=false;let title='',fields='';const date=input('date','Data',e.date||dateKey(),'date',`required min="2000-01-01" max="${dateKey()}"`);const amount=input('amount','Valor (R$)',e.amount??'','number','required min="0.01" step="0.01" max="10000000" inputmode="decimal"');if(type==='income'){title=id?'Editar corrida':'Registrar corrida';const ocrBtn='<div class="full" style="margin-bottom:12px"><button type="button" data-action="ocr" style="width:100%;background:rgba(52, 214, 172, 0.1);color:var(--primary);border:1px dashed var(--primary);font-weight:bold;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-right:6px;vertical-align:-4px;"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11z"/><circle cx="12" cy="13" r="4"/></svg> Ler Print (Auto-preencher Valor)</button></div>';const quickIncome = `<div class="full" style="display:flex;gap:8px;margin-bottom:6px;margin-top:-6px;overflow-x:auto;padding-bottom:4px;"><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='10.00'">R$ 10</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='15.00'">R$ 15</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='20.00'">R$ 20</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px" onclick="document.querySelector('input[name=amount]').value='30.00'">R$ 30</button></div>`;fields=ocrBtn+date+select('app','Aplicativo',['Uber','99','inDrive','Particular','Outros'],e.app)+amount+quickIncome+input('km','Quilômetros registrados (Opcional)',e.km??'','number','min="0" step="0.1" max="100000" inputmode="decimal"')+input('minutes','Tempo (Minutos) (Opcional)',e.hours?round(e.hours*60):'','number','min="0" max="1440" step="1" inputmode="numeric"')+input('description','Observação (opcional)',e.description||'','text','maxlength="160"')+'<p class="notice full">Para incluir espera e todos os deslocamentos no resultado por hora/km, prefira o fechamento diário.</p>';}
if(type==='daily'){title=id?'Editar fechamento':'Fechar dia';fields=date+input('count','Quantidade de corridas',e.count??'','number','required min="0" step="1" max="10000" inputmode="numeric"')+['Uber','99','inDrive','Particular','Outros'].map((app,i)=>input('app'+i,app+' (R$)',e.breakdown?.[app]??(app==='Outros'&&e.mode==='daily'&&!e.breakdown?e.amount:0),'number','required min="0" step="0.01" max="10000000" inputmode="decimal"')).join('')+input('km','KM totais do trabalho',e.km??'','number','required min="0" step="0.1" max="100000" inputmode="decimal"')+input('hours','Horas totais (ex: 8.5 para 8h30)',e.hours??'','number','required min="0" step="0.1" max="24" inputmode="decimal"')+input('description','Observação (opcional)',e.description||'','text','maxlength="160"')+'<p class="notice full">Inclua espera e km sem passageiro. Lance despesas separadamente em Despesas. O valor recebido deve ser o repasse ao motorista, sem descontar a taxa do aplicativo novamente.</p>';}
if(type==='expense'){title=id?'Editar despesa':'Registrar despesa';const quickExpense = `<div class="full" style="display:flex;gap:8px;margin-bottom:6px;margin-top:-6px;overflow-x:auto;padding-bottom:4px;"><button type="button" class="ghost" style="padding:6px 12px;font-size:13px;white-space:nowrap" onclick="document.querySelector('select[name=category]').value='Combustível';document.querySelector('input[name=amount]').value='50.00'">⛽ R$ 50</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px;white-space:nowrap" onclick="document.querySelector('select[name=category]').value='Combustível';document.querySelector('input[name=amount]').value='100.00'">⛽ R$ 100</button><button type="button" class="ghost" style="padding:6px 12px;font-size:13px;white-space:nowrap" onclick="document.querySelector('select[name=category]').value='Alimentação';document.querySelector('input[name=amount]').value='25.00'">🍔 R$ 25</button></div>`;fields=date+select('category','Categoria',categories,e.category)+amount+quickExpense+input('description','Descrição (opcional)',e.description||'','text','maxlength="160"');}
if(type==='fund'){title=id?'Editar aporte':'Registrar aporte';fields=date+'<label>Caixinha / Objetivo<input name="name" list="fundOpts" value="'+esc(e.name||'Reserva de emergência')+'" required maxlength="100"><datalist id="fundOpts"><option value="Reserva de emergência"></option><option value="Férias e 13º"></option></datalist></label>'+amount;}
if(type==='vehicle'){title='Configurar veículo';fields=input('vehicle','Modelo',s.profile.vehicle,'text','required maxlength="100"')+input('odometer','Hodômetro atual (km)',s.profile.odometer,'number','required min="0" max="10000000" step="1" inputmode="numeric"')+input('serviceAt','Próxima revisão: hodômetro-alvo',s.profile.serviceAt,'number','required min="0" max="10000000" step="1" inputmode="numeric"')+input('consumption','Consumo informado (km/L)',s.profile.consumption,'number','required min="0" max="100" step="0.1" inputmode="decimal"')+input('reservePerKm','Reserva sugerida por km (R$)',s.reservePerKm,'number','required min="0" max="100" step="0.01" inputmode="decimal"')+input('ipva','Data Venc. IPVA (Opcional)',s.profile.ipva||'','date','')+input('seguro','Data Venc. Seguro (Opcional)',s.profile.seguro||'','date','')+'<p class="notice full">Deixe em branco as datas que não deseja acompanhar.</p>';}
if(type==='goals'){title='Editar metas';fields=input('daily','Saldo diário desejado (R$)',s.goals.daily,'number','required min="1" max="10000000" step="0.01" inputmode="decimal"')+input('monthly','Saldo mensal desejado (R$)',s.goals.monthly,'number','required min="1" max="10000000" step="0.01" inputmode="decimal"')+input('reserve','Objetivo de reserva (R$)',s.goals.reserve,'number','required min="1" max="10000000" step="0.01" inputmode="decimal"');}
if(type==='profile'){title='Seu nome';fields=input('name','Como você prefere ser chamado?',s.profile.name,'text','required maxlength="60"');}
$('#modalTitle').textContent=title;$('#fields').innerHTML=`<div class="form-grid">${fields}</div>`;$('#formError').textContent='';$('#modal').showModal();}
async function saveForm(ev){ev.preventDefault();if(saving)return;const f=Object.fromEntries(new FormData(ev.target)),{type,id}=formContext,s=state(),n=k=>Number(f[k]);let e;if(['income','daily','expense','fund'].includes(type)&&(!validDate(f.date)||f.date>dateKey()))return formError('Informe uma data válida, até hoje.');if(type==='income'||type==='daily'){const conflicts=s.entries.filter(e=>e.id!==id&&e.type==='income'&&e.date===f.date);if(conflicts.some(e=>e.mode==='daily')||(type==='daily'&&conflicts.length))return formError('Já existem ganhos neste dia. Edite o fechamento existente ou remova as corridas antes de criar um fechamento.');let breakdown;let amount=n('amount');if(type==='daily'){breakdown={};['Uber','99','inDrive','Particular','Outros'].forEach((app,i)=>breakdown[app]=n('app'+i));amount=round(Object.values(breakdown).reduce((a,b)=>a+b,0));}if(!finite(amount,.01))return formError('Informe pelo menos um ganho maior que zero.');const hours=type==='daily'?n('hours'):n('minutes')/60;if(hours+conflicts.reduce((sum,e)=>sum+e.hours,0)>24)return formError('O tempo total registrado neste dia não pode ultrapassar 24 horas.');e={id:id||uid(),type:'income',mode:type==='daily'?'daily':'ride',date:f.date,app:type==='daily'?'Todos':f.app,amount:round(amount),km:n('km'),hours,count:type==='daily'?n('count'):1,description:f.description.trim(),...(breakdown?{breakdown}:{})};}
if(type==='expense')e={id:id||uid(),type:'expense',date:f.date,amount:round(n('amount')),category:f.category,description:f.description.trim()};
const next=JSON.parse(JSON.stringify(s));if(e){const i=next.entries.findIndex(x=>x.id===id);if(i<0)next.entries.push(e);else next.entries[i]=e;}
if(type==='fund'){const fund={id:id||uid(),date:f.date,name:f.name.trim(),amount:round(n('amount'))};if(!fund.name)return formError('Informe o objetivo do aporte.');const i=next.funds.findIndex(x=>x.id===id);if(i<0)next.funds.push(fund);else next.funds[i]=fund;}
if(type==='vehicle'){next.profile={...next.profile,vehicle:f.vehicle.trim(),odometer:n('odometer'),serviceAt:n('serviceAt'),consumption:n('consumption'),ipva:f.ipva||'',seguro:f.seguro||''};next.reservePerKm=n('reservePerKm');}
if(type==='goals')next.goals={daily:n('daily'),monthly:n('monthly'),reserve:n('reserve')};
if(type==='profile'){if(!f.name.trim())return formError('Informe seu nome.');next.profile.name=f.name.trim();}
if(!validBackup(next))return formError('Confira os valores informados. Não foi possível salvar.');
const successMsg = type === 'income' ? 'Ganho salvo com sucesso!' : type === 'expense' ? 'Despesa salva com sucesso!' : 'Registro salvo com sucesso!';
if(await commit(next,demo?'Salvo na demonstração.':successMsg)){dirty=false;$('#modal').close();}
}
function formError(msg){$('#formError').textContent=msg;}
function remove(id,fund=false){const key=fund?'funds':'entries',item=state()[key].find(e=>e.id===id);if(!item)return;if((state().trash||[]).length>=5000)return toast('A lixeira atingiu o limite. Exporte um backup e preserve seus registros antes de continuar.');if(!confirm(`Mover o registro de ${money(item.amount)} para a lixeira? Você poderá recuperá-lo em Perfil e backup.`))return;mutate(s=>{s[key]=s[key].filter(e=>e.id!==id);s.trash=s.trash||[];s.trash.push({trashId:uid(),key,item,deletedAt:dateKey()});},'Registro movido para a lixeira. Você pode restaurá-lo em Perfil.');}
function restoreTrash(id){const t=(state().trash||[]).find(x=>x.trashId===id);if(!t)return;const next=JSON.parse(JSON.stringify(state()));next[t.key].push(t.item);next.trash=next.trash.filter(x=>x.trashId!==id);if(!validBackup(next))return toast('Não foi possível restaurar: existe ganho duplicado, conflito de horas ou registro incompatível.');commit(next,'Registro restaurado.');}
function download(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(){const quote=v=>'"'+String(v??'').replace(/^[\s\u0000-\u001f]*[=+@\-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['Data','Tipo','Aplicativo ou categoria','Descrição','Valor BRL','KM','Horas','Corridas'],...selected().map(e=>[e.date,e.type==='income'?'Ganho':'Despesa',e.app||e.category,e.description,Number(e.amount).toFixed(2).replace('.',','),e.km??'',e.hours??'',e.count??''])];download(`capitalex-relatorio-${dateKey()}.csv`,'\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
function toggleDemo(){undo=null;if(demo){demo=null;render();return;}demo=defaults();demo.profile={name:'Motorista',vehicle:'Sedã 2022',odometer:68420,serviceAt:70000,consumption:12.4};demo.goals={daily:400,monthly:8000,reserve:20000};[320,410,390,480,520,610,428].forEach((amount,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const date=dateKey(d);demo.entries.push({id:uid(),type:'income',mode:'daily',date,amount,app:'Todos',breakdown:{Uber:round(amount*.7),'99':round(amount*.3)},km:round(amount/2.3),hours:8,count:20+i,description:'Exemplo de fechamento'});demo.entries.push({id:uid(),type:'expense',date,amount:round([82,88,82,95,111,119,104][i]*.75),category:'Combustível',description:'Exemplo de despesa'});demo.entries.push({id:uid(),type:'expense',date,amount:round([82,88,82,95,111,119,104][i]*.25),category:i%2?'Celular':'Alimentação',description:'Exemplo de despesa'});});demo.funds=[{id:uid(),date:dateKey(),name:'Reserva de emergência',amount:5000}];render();}
document.addEventListener('click',async ev=>{if(saving)return;const b=ev.target.closest('button');const aTag=ev.target.closest('a');if((b||aTag)&&navigator.vibrate)navigator.vibrate(30);if(!b)return;if(b.dataset.edit){const e=state().entries.find(e=>e.id===b.dataset.edit);openForm(e.type==='income'?(e.mode==='daily'?'daily':'income'):'expense',e.id);}if(b.dataset.delete)remove(b.dataset.delete);if(b.dataset.restore)restoreTrash(b.dataset.restore);if(b.dataset.fundEdit)openForm('fund',b.dataset.fundEdit);if(b.dataset.fundDelete)remove(b.dataset.fundDelete,true);const a=b.dataset.action;if(!a)return;if(a==='ocr')return $('#ocrInput').click();if(a==='theme'){document.documentElement.classList.toggle('light-theme');const isLight = document.documentElement.classList.contains('light-theme');localStorage.setItem('capitalex_theme',isLight?'light':'dark');if(window.Chart){Chart.defaults.color=isLight?'#475569':'#94a3b8';Chart.defaults.borderColor=isLight?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.05)';Object.values(Chart.instances).forEach(c=>c.update());}}if(['income','expense','daily','vehicle','goals','profile','fund'].includes(a))openForm(a);if(a==='reload')reloadData();if(a==='recovery')recoverPrevious();if(a==='raw')exportRaw();if(a==='csv')csv();if(a==='print')window.print();if(a==='backup')download(`capitalex-${demo?'demonstracao-':''}backup-${dateKey()}.json`,JSON.stringify(state(),null,2),'application/json');if(a==='import'&&!demo)$('#importFile').click();if(a==='demo')toggleDemo();if(a==='undo'&&undo&&undo.demo===!!demo){const u=undo;const duplicate=state()[u.key].some(e=>e.id===u.item.id);const dayConflict=u.key==='entries'&&u.item.type==='income'&&state().entries.some(e=>e.type==='income'&&e.date===u.item.date&&(e.mode==='daily'||u.item.mode==='daily'));if(duplicate||dayConflict)return toast('Não é possível restaurar: há um registro conflitante.');if(await mutate(s=>s[u.key].push(u.item),'Exclusão desfeita.')){undo=null;render();}}});
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
window.DriverApp={
 async load(){
  const r=await window.Account.api('data');
  const data=r.data?parseBackup(JSON.stringify(r.data)):defaults();
  saved=data;cloudRevision=r.revision;cloudPrevious=r.previous;loadedRaw=JSON.stringify(data);storageIssue='';tabConflict=false;demo=null;render();
 },
 clear(){saved=defaults();cloudRevision=0;cloudPrevious=null;loadedRaw=null;demo=null;dirty=false;$('#modal').close();render();}
};
window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
if(localStorage.getItem('capitalex_theme')!=='dark')document.documentElement.classList.add('light-theme');
function navigate(){route=location.hash.slice(1);if(!paths[route])route='dashboard';render();}window.addEventListener('hashchange',navigate);navigate();

'use strict';
(()=>{
 const el=id=>document.getElementById(id);let email='',session=null,refreshing=null;
 function message(text){el('accountMessage').textContent=text;}
 function lock(){document.body.classList.add('account-view');document.body.classList.toggle('locked',!session?.billing?.active);el('accountGate').hidden=false;document.getElementById('modal')?.close();}
 function unlock(){document.body.classList.remove('locked','account-view');el('accountGate').hidden=true;}
 async function request(action,method='GET',payload){
  let r;try{r=await fetch('/api/'+action,{method,credentials:'same-origin',cache:'no-store',headers:payload!==undefined?{'Content-Type':'application/json'}:{},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});}catch{throw Error('Sem conexão. Seus dados não foram alterados. Tente novamente.');}
  const data=await r.json().catch(()=>({error:'O serviço ainda precisa ser ativado pelo responsável.'}));
  if(!r.ok){const e=Error(data.error||'Não foi possível concluir.');e.status=r.status;throw e;}return data;
 }
 async function api(action,method='GET',payload,retry=true){
  try{return await request(action,method,payload);}catch(e){
   if(e.status===401&&retry&&!['otp','verify','refresh','logout'].includes(action)){
    try{if(!refreshing)refreshing=request('refresh','POST',{}).finally(()=>refreshing=null);await refreshing;return await api(action,method,payload,false);}catch(err){if(err.status===401){session=null;showLogin();}throw err;}
   }
   if(e.status===402){if(session?.billing)session.billing.active=false;stage('stepPlan');lock();el('emailForm').hidden=true;el('codeForm').hidden=true;el('subscriptionPanel').hidden=false;message(e.message);}
   throw e;
  }
 }
 function stage(name){['stepLogin','stepPlan','stepPanel'].forEach(id=>{if(id===name)el(id).setAttribute('aria-current','step');else el(id).removeAttribute('aria-current');});el('accountStage').textContent=name==='stepLogin'?'SUA CONTA':'CONTA E ASSINATURA';}
 function showLogin(){session=null;stage('stepLogin');lock();el('gateTitle').textContent='Entre na sua conta';el('gateDescription').textContent='Receba um código no seu e-mail. No primeiro acesso, sua conta será criada.';el('emailForm').hidden=false;el('codeForm').hidden=true;el('subscriptionPanel').hidden=true;}
 function showSubscription(){
  stage('stepPlan');lock();el('emailForm').hidden=true;el('codeForm').hidden=true;el('subscriptionPanel').hidden=false;
  el('gateTitle').textContent=session.billing.active?'Sua assinatura':'Ative seu acesso';
  el('gateDescription').textContent=session.email;
  const b=session.billing,labels={none:'Sem assinatura',active:'Pagamento confirmado',past_due:'Pagamento pendente',unpaid:'Pagamento pendente',canceled:'Assinatura encerrada',incomplete:'Pagamento não concluído',incomplete_expired:'Pagamento não concluído',paused:'Assinatura pausada'};
  el('subscriptionStatus').textContent=(labels[b.status]||'Aguardando confirmação')+(b.endsAt?' · '+(b.cancelAtPeriodEnd?'Acesso até ':'Período até ')+new Date(b.endsAt*1000).toLocaleDateString('pt-BR'):'');
  el('subscribe').hidden=b.active||['past_due','unpaid','paused','incomplete'].includes(b.status);
  el('manageSubscription').hidden=!b.hasCustomer;
  el('checkSubscription').textContent=b.active?'Voltar ao painel':'Já paguei · verificar acesso';
 }
 async function boot(){
  try{session=await api('session');if(session.billing.active){await window.DriverApp.load();unlock();message('');}else{showSubscription();message(new URLSearchParams(location.search).get('pagamento')==='retorno'?'Estamos aguardando a confirmação do pagamento. Use “Já paguei” para verificar novamente.':'Ative seu plano para liberar ganhos, despesas e metas neste painel.');}}
  catch(e){if(e.status===401){showLogin();message('Use seu e-mail para entrar com segurança.');}else{lock();message(e.message);}}
 }
 async function busy(button,fn){button.disabled=true;try{await fn();}catch(e){message(e.message);if(!document.body.classList.contains('locked'))window.toast?.(e.message);}finally{button.disabled=false;}}
 el('emailForm').onsubmit=ev=>{ev.preventDefault();busy(ev.submitter,async()=>{email=el('accountEmail').value.trim();await api('otp','POST',{email});el('emailForm').hidden=true;el('codeForm').hidden=false;message('Enviamos um código para '+email+'. Confira também o spam.');el('accountCode').focus();});};
 el('codeForm').onsubmit=ev=>{ev.preventDefault();busy(ev.submitter,async()=>{await api('verify','POST',{email,code:el('accountCode').value.trim()});el('accountCode').value='';await boot();});};
 el('changeEmail').onclick=()=>{showLogin();message('Você pode solicitar outro código após 60 segundos.');};
 async function goBilling(action,button){await busy(button,async()=>{const r=await api(action,'POST',{});const u=new URL(r.url);if(u.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(u.hostname))throw Error('Destino de pagamento inválido.');location.assign(u.href);});}
 el('subscribe').onclick=ev=>goBilling('checkout',ev.currentTarget);
 el('manageSubscription').onclick=ev=>goBilling('portal',ev.currentTarget);
 el('checkSubscription').onclick=ev=>busy(ev.currentTarget,boot);
 const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('capitalex-session'):null;
 async function logout(){await api('logout','POST',{});channel?.postMessage('logout');window.DriverApp.clear();session=null;showLogin();message('Sessão encerrada.');}
 channel?.addEventListener('message',ev=>{if(ev.data==='logout'){window.DriverApp.clear();session=null;showLogin();message('Sessão encerrada em outra aba.');}});
 el('gateLogout').onclick=ev=>busy(ev.currentTarget,logout);
 el('accountLogout').onclick=ev=>busy(ev.currentTarget,logout);
 el('accountMenu').onclick=async()=>{try{session=await api('session');showSubscription();message('Gerencie cobrança e cancelamento pelo portal seguro.');}catch(e){lock();message(e.message);}};
 el('exportAccount').onclick=ev=>busy(ev.currentTarget,async()=>{const r=await api('export');if(!r.data){message('Sua conta ainda não tem registros.');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='capitalex-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Backup solicitado. Guarde-o em local protegido.');});
 document.querySelector('aside nav').addEventListener('click',ev=>{if(ev.target.closest('a')&&session?.billing?.active)unlock();});
 document.querySelector('aside .brand').addEventListener('click',()=>{if(session?.billing?.active)unlock();});
 window.Account={api};window.addEventListener('DOMContentLoaded',boot);
})();

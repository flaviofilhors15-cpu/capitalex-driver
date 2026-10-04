import {createHmac} from 'node:crypto';
import {parseBackup} from './validation.mjs';
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export const fail=(s,m)=>{throw new HttpError(s,m);};
export function env(){
 const names=['APP_URL','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY','STRIPE_PRICE_ID','RATE_LIMIT_SECRET'];
 const e=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 if(names.some(n=>!e[n])||e.RATE_LIMIT_SECRET.length<32)fail(503,'Serviço em configuração. O responsável precisa concluir a ativação.');
 if(new URL(e.APP_URL).protocol!=='https:'||new URL(e.SUPABASE_URL).protocol!=='https:')fail(503,'Configuração de conexão inválida.');
 e.APP_URL=new URL(e.APP_URL).origin;e.SUPABASE_URL=e.SUPABASE_URL.replace(/\/$/,'');return e;
}
export async function remote(url,options={}){
 let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});}catch{fail(503,'Serviço temporariamente indisponível. Tente novamente.');}
 const d=await r.json().catch(()=>({}));return {r,d};
}
export async function db(e,path,method='GET',body,prefer){
 const {r,d}=await remote(e.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:e.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+e.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok)fail(503,'Não foi possível acessar seus dados. Tente novamente.');return d;
}
export async function auth(e,path,body,token){
 return remote(e.SUPABASE_URL+'/auth/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:e.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
export function cookieValues(req){return Object.fromEntries((req.headers.get('cookie')||'').split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2));}
export function setSession(headers,s){
 if(!s.access_token||!s.refresh_token)fail(401,'Confirmação inválida. Solicite outro código.');
 headers.append('Set-Cookie',`__Host-cd_access=${s.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.min(s.expires_in||3600,3600)}`);
 headers.append('Set-Cookie',`__Host-cd_refresh=${s.refresh_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
}
export function clearSession(headers){for(const name of ['__Host-cd_access','__Host-cd_refresh'])headers.append('Set-Cookie',`${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);}
export async function user(req,e){
 const token=cookieValues(req)['__Host-cd_access'];if(!token)fail(401,'Entre na sua conta para continuar.');
 const {r,d}=await auth(e,'user',undefined,token);
 if(!r.ok||!d.id||!d.email_confirmed_at)fail(401,'Sua sessão expirou. Entre novamente.');
 return d;
}
export async function account(e,id){
 await db(e,'driver_accounts?on_conflict=user_id','POST',{user_id:id},'resolution=ignore-duplicates,return=minimal');
 const rows=await db(e,'driver_accounts?user_id=eq.'+encodeURIComponent(id)+'&select=*');
 if(!rows[0])fail(503,'Conta indisponível.');return rows[0];
}
export async function rate(e,key,limit,seconds=900){
 const digest=createHmac('sha256',e.RATE_LIMIT_SECRET).update(key).digest('hex');
 const ok=await db(e,'rpc/driver_rate_limit','POST',{p_key:digest,p_limit:limit,p_seconds:seconds});
 if(ok!==true)fail(429,'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}
export async function stripe(e,path,body,idempotency){
 const {r,d}=await remote('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+e.STRIPE_SECRET_KEY,'Stripe-Version':'2025-06-30.basil',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:new URLSearchParams(body).toString()}:{})});
 if(!r.ok)fail(503,'O serviço de assinatura está indisponível. Tente novamente.');return d;
}
export function entitled(s,priceId,now=Date.now()/1000){
 const item=s.items?.data?.find(i=>i.price?.id===priceId&&i.quantity===1);
 const invoice=s.latest_invoice;
 return s.status==='active'&&!s.pause_collection&&item?.current_period_end>now&&invoice?.status==='paid'&&invoice.amount_paid>=2595&&invoice.currency==='brl';
}
export async function billing(e,a){
 if(!a.stripe_customer_id)return {active:false,status:'none',hasCustomer:false};
 const result=await stripe(e,'subscriptions?'+new URLSearchParams({customer:a.stripe_customer_id,status:'all',limit:'100','expand[]':'data.latest_invoice'}));
 const matches=result.data.filter(s=>s.items?.data?.some(i=>i.price?.id===e.STRIPE_PRICE_ID));
 const s=matches.find(s=>entitled(s,e.STRIPE_PRICE_ID))||matches.find(s=>!['canceled','incomplete_expired'].includes(s.status))||matches[0];
 return {active:!!s&&entitled(s,e.STRIPE_PRICE_ID),status:s?.status||'none',hasCustomer:true,endsAt:s?.items?.data?.find(i=>i.price?.id===e.STRIPE_PRICE_ID)?.current_period_end||null,cancelAtPeriodEnd:!!s?.cancel_at_period_end};
}
export async function checkout(e,u,a){
 const price=await stripe(e,'prices/'+encodeURIComponent(e.STRIPE_PRICE_ID));
 if(!price.active||price.unit_amount!==2595||price.currency!=='brl'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.recurring?.usage_type!=='licensed')fail(503,'O plano precisa ser configurado como R$ 25,95 por mês.');
 if(!a.stripe_customer_id){
  const c=await stripe(e,'customers',{email:u.email,'metadata[user_id]':u.id},'capitalex-customer-'+u.id);
  const rows=await db(e,'driver_accounts?user_id=eq.'+u.id+'&stripe_customer_id=is.null','PATCH',{stripe_customer_id:c.id},'return=representation');
  a=rows[0]||await account(e,u.id);
 }
 const b=await billing(e,a);
 if(b.active||['past_due','unpaid','paused','incomplete'].includes(b.status))return portal(e,a);
 const open=await stripe(e,'checkout/sessions?'+new URLSearchParams({customer:a.stripe_customer_id,status:'open',limit:'100'}));
 const pending=open.data.find(s=>s.mode==='subscription'&&s.metadata?.plan===e.STRIPE_PRICE_ID&&s.url);
 if(pending)return {url:pending.url};
 const s=await stripe(e,'checkout/sessions',{mode:'subscription',customer:a.stripe_customer_id,client_reference_id:u.id,'line_items[0][price]':e.STRIPE_PRICE_ID,'line_items[0][quantity]':'1','payment_method_types[0]':'card','metadata[plan]':e.STRIPE_PRICE_ID,'subscription_data[metadata][user_id]':u.id,success_url:e.APP_URL+'/?pagamento=retorno',cancel_url:e.APP_URL+'/?pagamento=cancelado',locale:'pt-BR'},'capitalex-checkout-'+u.id+'-'+Math.floor(Date.now()/1800000));
 return {url:s.url};
}
export async function portal(e,a){if(!a.stripe_customer_id)fail(400,'Sua conta ainda não tem uma assinatura.');const s=await stripe(e,'billing_portal/sessions',{customer:a.stripe_customer_id,return_url:e.APP_URL+'/?assinatura=retorno'});return {url:s.url};}
export async function body(req,max=1000000){
 if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'Envie dados em JSON.');
 if(Number(req.headers.get('content-length'))>max)fail(413,'Arquivo muito grande. Limite: 1 MB.');
 const text=await req.text();if(Buffer.byteLength(text)>max)fail(413,'Arquivo muito grande. Limite: 1 MB.');
 try{return JSON.parse(text,(k,v)=>{if(['__proto__','constructor','prototype'].includes(k))throw Error();return v;});}catch{fail(400,'Dados inválidos.');}
}
export async function saveData(e,u,a,payload){
 if(!Number.isSafeInteger(payload.revision)||payload.revision<0)fail(400,'Versão inválida.');
 let data;try{data=parseBackup(JSON.stringify(payload.data));}catch{fail(400,'Há registros inválidos no arquivo.');}
 if(a.revision!==payload.revision)fail(409,'Os dados mudaram em outra aba ou aparelho. Recarregue antes de salvar.');
 const rows=await db(e,'driver_accounts?user_id=eq.'+u.id+'&revision=eq.'+payload.revision,'PATCH',{data,previous_data:a.data,revision:a.revision+1,updated_at:new Date().toISOString()},'return=representation');
 if(!rows.length)fail(409,'Os dados mudaram em outro aparelho. Recarregue antes de salvar.');
 return {revision:rows[0].revision};
}

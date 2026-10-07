import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/api.mjs';
import {entitled} from '../server/core.mjs';
import {parseBackup} from '../server/validation.mjs';
Object.assign(process.env,{APP_URL:'https://app.test',SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'secret',STRIPE_SECRET_KEY:'sk_test_x',STRIPE_PRICE_ID:'price_month',RATE_LIMIT_SECRET:'test-secret-at-least-thirty-two-characters'});
const uid='11111111-1111-4111-8111-111111111111';
const valid=()=>({version:2,profile:{name:'Teste',vehicle:'',odometer:0,serviceAt:0,consumption:0},goals:{daily:300,monthly:6000,reserve:10000},reservePerKm:.15,entries:[],funds:[],trash:[]});
const sub=()=>({id:'sub_x',status:'active',items:{data:[{price:{id:'price_month'},quantity:1,current_period_end:Math.floor(Date.now()/1000)+3000}]},latest_invoice:{status:'paid',amount_paid:2595,currency:'brl'}});
function setup({subscription=sub(),row={},userOk=true,patchConflict=false,price={},verifyOk=true}={}){
 const calls=[];let account={user_id:uid,stripe_customer_id:'cus_x',data:valid(),previous_data:null,revision:2,...row};
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname,query=new URL(url).searchParams;calls.push({url:String(url),options});let data={};let status=200;
  if(path==='/auth/v1/user'){data=userOk?{id:uid,email:'test@example.com',email_confirmed_at:'2026-01-01'}:{};status=userOk?200:401;}
  else if(path==='/auth/v1/verify'){data=verifyOk?{access_token:'access',refresh_token:'refresh',expires_in:3600}:{};status=verifyOk?200:400;}
  else if(path==='/rest/v1/rpc/driver_rate_limit')data=true;
  else if(path==='/rest/v1/driver_accounts'){
   if(options.method==='GET')data=[account];
   if(options.method==='PATCH'){assert.equal(query.get('user_id'),'eq.'+uid);data=patchConflict?[]:[{...account,...JSON.parse(options.body)}];}
  }else if(path==='/v1/subscriptions')data={data:subscription?[subscription]:[]};
  else if(path==='/v1/prices/price_month')data={active:true,unit_amount:2595,currency:'brl',recurring:{interval:'month',interval_count:1,usage_type:'licensed'},...price};
  else if(path==='/v1/checkout/sessions')data=options.method==='POST'?{url:'https://checkout.stripe.com/test'}:{data:[]};
  else if(path==='/v1/billing_portal/sessions')data={url:'https://billing.stripe.com/test'};
  else if(path==='/auth/v1/otp'||path==='/auth/v1/logout')data={};
  else throw Error('Unexpected fetch '+url);
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 };return calls;
}
function req(action,method='GET',body,auth=true,origin='https://app.test'){
 return new Request('https://app.test/api/'+action,{method,headers:{...(auth?{cookie:'__Host-cd_access=access'}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
test('anonymous cannot read private records',async()=>{setup();assert.equal((await handler(req('data','GET',undefined,false))).status,401);});
test('forged or expired session is refused',async()=>{setup({userOk:false});assert.equal((await handler(req('data'))).status,401);});
test('unpaid cannot read or write even with a logged-in session',async()=>{setup({subscription:null});assert.equal((await handler(req('data'))).status,402);assert.equal((await handler(req('data','PUT',{data:valid(),revision:2}))).status,402);});
test('cross-site POST is refused before providers are called',async()=>{const calls=setup();assert.equal((await handler(req('checkout','POST',{},true,'https://evil.test'))).status,403);assert.equal(calls.length,0);});
test('mutations without Origin are refused',async()=>{setup();const r=req('logout','POST',{});r.headers.delete('Origin');assert.equal((await handler(r)).status,403);});
test('paid user sees own data and private no-store headers',async()=>{const calls=setup();const r=await handler(req('data'));assert.equal(r.status,200);assert.equal((await r.json()).revision,2);assert.match(r.headers.get('cache-control'),/no-store/);assert(calls.some(c=>c.url.includes('user_id=eq.'+uid)));});
test('body cannot select another user and price cannot come from the client',async()=>{const calls=setup({subscription:null});const r=await handler(req('checkout','POST',{user_id:'victim',price:1}));assert.equal(r.status,200);const call=calls.find(c=>c.options.method==='POST'&&c.url.includes('/checkout/sessions'));const p=new URLSearchParams(call.options.body);assert.equal(p.get('line_items[0][price]'),'price_month');assert.equal(p.get('client_reference_id'),uid);assert.equal(p.get('customer'),'cus_x');});
test('incorrect configured price blocks checkout',async()=>{setup({subscription:null,price:{unit_amount:100}});assert.equal((await handler(req('checkout','POST',{}))).status,503);});
test('active subscription sends user to portal instead of charging again',async()=>{const calls=setup();const r=await handler(req('checkout','POST',{}));assert.match((await r.json()).url,/billing.stripe.com/);assert(!calls.some(c=>c.url.includes('checkout/sessions')&&c.options.method==='POST'));});
test('paid session saves with optimistic concurrency and previous snapshot',async()=>{const calls=setup();const data=valid();data.profile.name='Novo';const r=await handler(req('data','PUT',{data,revision:2}));assert.equal(r.status,200);assert.equal((await r.json()).revision,3);const update=calls.find(c=>c.options.method==='PATCH');assert.match(update.url,/revision=eq.2/);assert.equal(JSON.parse(update.options.body).previous_data.profile.name,'Teste');});
test('old revision and a race at the database both refuse overwrite',async()=>{setup();assert.equal((await handler(req('data','PUT',{data:valid(),revision:1}))).status,409);setup({patchConflict:true});assert.equal((await handler(req('data','PUT',{data:valid(),revision:2}))).status,409);});
test('invalid financial data refused server-side',async()=>{setup();const d=valid();d.goals.daily=-1;assert.equal((await handler(req('data','PUT',{data:d,revision:2}))).status,400);});
test('oversized request refused',async()=>{setup();assert.equal((await handler(req('data','PUT',{data:valid(),revision:2,extra:'x'.repeat(1000001)}))).status,413);});
test('OTP yields HttpOnly Secure cookies without tokens in response body',async()=>{setup();const r=await handler(req('verify','POST',{email:'test@example.com',code:'123456'},false),{ip:'127.0.0.1'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.deepEqual(await r.json(),{ok:true});});
test('invalid OTP refuses session',async()=>{setup({verifyOk:false});assert.equal((await handler(req('verify','POST',{email:'test@example.com',code:'123456'},false))).status,401);});
test('cancelled account can export its own records',async()=>{setup({subscription:null});const r=await handler(req('export'));assert.equal(r.status,200);assert.equal((await r.json()).data.profile.name,'Teste');});
test('status alone, wrong plan, expired period, no paid invoice and pause do not grant access',()=>{
 assert.equal(entitled(sub(),'price_month'),true);
 for(const status of ['past_due','unpaid','canceled','trialing','incomplete','paused'])assert.equal(entitled({...sub(),status},'price_month'),false);
 assert.equal(entitled(sub(),'other'),false);
 assert.equal(entitled({...sub(),latest_invoice:{status:'open'}},'price_month'),false);
 assert.equal(entitled({...sub(),pause_collection:{}},'price_month'),false);
 const s=sub();s.items.data[0].current_period_end=1;assert.equal(entitled(s,'price_month'),false);
});
test('prototype keys and duplicate gains rejected',()=>{assert.throws(()=>parseBackup('{"__proto__":{}}'));const d=valid();const e={id:'a',date:'2026-01-01',type:'income',mode:'daily',app:'Todos',description:'',amount:10,km:5,hours:1,count:1};d.entries=[e,{...e,id:'b'}];assert.throws(()=>parseBackup(JSON.stringify(d)));});
test('rate limit fails closed',async()=>{setup();const original=globalThis.fetch;globalThis.fetch=async(url,o)=>String(url).includes('driver_rate_limit')?new Response('false'):original(url,o);assert.equal((await handler(req('otp','POST',{email:'test@example.com'},false))).status,429);});
test('missing configuration does not expose data',async()=>{const old=process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_SECRET_KEY;assert.equal((await handler(req('session'))).status,503);process.env.STRIPE_SECRET_KEY=old;});

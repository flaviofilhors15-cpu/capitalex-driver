import {env,body,auth,user,account,rate,billing,checkout,portal,saveData,setSession,clearSession,cookieValues,fail,HttpError} from '../../server/core.mjs';
export const config={path:'/api/:action'};
export default async function handler(req,context={}){
 const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Netlify-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie'});
 let status=200,result;
 try{
  const e=env(),action=new URL(req.url).pathname.split('/').pop();
  if(!['GET','POST','PUT'].includes(req.method))fail(405,'Método não permitido.');
  if(req.method!=='GET'&&req.headers.get('origin')!==e.APP_URL)fail(403,'Origem não autorizada.');
  const allowed={otp:'POST',verify:'POST',refresh:'POST',logout:'POST',session:'GET',data:['GET','PUT'],checkout:'POST',portal:'POST',export:'GET'};
  if(![].concat(allowed[action]||[]).includes(req.method))fail(404,'Rota não encontrada.');
  if(['otp','verify','refresh'].includes(action)){
   // context.ip é fornecido pela Netlify. Não confiar em X-Forwarded-For do cliente.
   await rate(e,'auth-ip:'+String(context.ip||'unknown'),40);
  }
  if(action==='otp'||action==='verify'){
   const p=await body(req,2048),email=typeof p.email==='string'?p.email.trim().toLowerCase():'';
   if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail(400,'Informe um e-mail válido.');
   await rate(e,action+':'+email,action==='otp'?4:10);
   if(action==='otp'){
    const {r}=await auth(e,'otp',{email,create_user:true});
    if(!r.ok)fail(r.status===429?429:503,'Não foi possível enviar o código. Aguarde e tente novamente.');
    result={ok:true};
   }else{
    if(typeof p.code!=='string'||!/^\d{6,10}$/.test(p.code))fail(400,'Confira o código recebido por e-mail.');
    const {r,d}=await auth(e,'verify',{email,token:p.code,type:'email'});
    if(!r.ok)fail(401,'Código inválido ou expirado. Solicite um novo.');
    setSession(headers,d);result={ok:true};
   }
  }else if(action==='refresh'){
   const token=cookieValues(req)['__Host-cd_refresh'];if(!token)fail(401,'Entre na sua conta.');
   const {r,d}=await auth(e,'token?grant_type=refresh_token',{refresh_token:token});
   if(!r.ok){clearSession(headers);fail(401,'Sua sessão expirou. Entre novamente.');}
   setSession(headers,d);result={ok:true};
  }else if(action==='logout'){
   const token=cookieValues(req)['__Host-cd_access'];
   if(token){const {r}=await auth(e,'logout?scope=local',{},token);if(!r.ok&&r.status!==401&&r.status!==403)fail(503,'Não foi possível encerrar a sessão. Tente novamente.');}
   clearSession(headers);result={ok:true};
  }else{
   const u=await user(req,e);await rate(e,'user:'+u.id,180,60);
   const a=await account(e,u.id);
   if(action==='checkout'){await rate(e,'checkout:'+u.id,8,60);result=await checkout(e,u,a);}
   else if(action==='portal'){result=await portal(e,a);}
   else if(action==='export')result={data:a.data}; // Direito de obter os próprios dados mesmo sem plano ativo.
   else{
    const b=await billing(e,a);
    if(action==='session')result={email:u.email,billing:b};
    else{
     if(!b.active)fail(402,'Ative sua assinatura para usar o painel.');
     result=req.method==='GET'?{data:a.data,previous:a.previous_data,revision:a.revision}:await saveData(e,u,a,await body(req));
    }
   }
  }
 }catch(err){status=err instanceof HttpError?err.status:500;result={error:err instanceof HttpError?err.message:'Ocorreu um erro. Tente novamente.'};}
 return new Response(JSON.stringify(result),{status,headers});
}

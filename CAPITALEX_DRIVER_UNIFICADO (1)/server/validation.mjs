const dateKey=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const ALLOWED_APPS=['Uber','99','inDrive','Particular','Outros'];
const ALLOWED_CATEGORIES=['Combustível','Alimentação','Manutenção','Seguro','Aluguel do veículo','Parcela do veículo','Celular','Pedágio','Estacionamento','Impostos e taxas','Outros'];
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

export {validBackup,parseBackup};

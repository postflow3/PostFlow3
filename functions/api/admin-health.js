import { getSession } from "../_lib/security.js";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Cookie"}});

export async function onRequestGet({request,env}){
 const session=await getSession(request,env);
 if(!session)return json({error:"Faça login para continuar."},401);
 if(!env.POSTFLOW3_DB)return json({error:"Banco de dados indisponível."},503);
 try{
  const admin=await env.POSTFLOW3_DB.prepare("SELECT id FROM users WHERE id = ? AND email = 'sergiouai3@gmail.com' COLLATE NOCASE AND role = 'admin' AND status = 'active' LIMIT 1").bind(session.userId).first();
  if(!admin)return json({error:"Acesso restrito à administração."},403);
  const checks=[];
  try{
   await env.POSTFLOW3_DB.prepare("SELECT 1 AS ok").first();
   checks.push({key:"database",label:"Banco de dados D1",status:"ok",detail:"Conexão e consulta simples concluídas."});
  }catch{
   checks.push({key:"database",label:"Banco de dados D1",status:"error",detail:"A consulta de verificação falhou."});
  }
  const configured=(name)=>Boolean(env[name]&&String(env[name]).trim());
  const add=(key,label,names,detail)=>checks.push({key,label,status:names.every(configured)?"ok":"warning",detail:names.every(configured)?detail:"Falta configurar uma ou mais variáveis necessárias no ambiente Preview."});
  add("session","Sessões e autenticação",["POSTFLOW3_SESSION_SECRET"],"Segredo de sessão presente; valor nunca é exibido.");
  add("google-oauth","OAuth Google/YouTube",["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"],"Credenciais OAuth presentes; a conexão real da conta precisa ser testada.");
  add("instagram-oauth","OAuth Instagram",["INSTAGRAM_APP_ID","INSTAGRAM_APP_SECRET","INSTAGRAM_REDIRECT_URI"],"Credenciais e callback presentes; publicação real depende das permissões Meta e da conta.");
  add("drive","Google Drive",["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"],"Credenciais Google presentes; acesso ao Drive e permissões do usuário não são testados por esta verificação.");
  add("ai","Geração de legendas por IA",["GEMINI_API_KEY"],"Chave presente; disponibilidade e cota do provedor não são testadas.");
  add("media","Armazenamento de mídia (Google Drive)",["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"],"O PostFlow3 usa Google Drive para a mídia; o binding POSTFLOW3_MEDIA não é obrigatório nesta configuração. O acesso real ao Drive precisa de teste com uma conta conectada.");
  let schedulerSecretPresent=false,schedulerLastRun=null;
  try {
   if(env.POSTFLOW3_KV){
    schedulerSecretPresent=Boolean(await env.POSTFLOW3_KV.get("system:scheduler-secret"));
    const last=await env.POSTFLOW3_KV.get("system:scheduler-last-run");
    if(last){const parsed=JSON.parse(last);schedulerLastRun={ok:parsed.ok===true,httpStatus:Number(parsed.httpStatus)||null,startedAt:parsed.startedAt||null,finishedAt:parsed.finishedAt||null,cron:String(parsed.cron||"").slice(0,80),error:parsed.error?String(parsed.error).slice(0,180):null};}
   }
  }catch{}
  checks.push({key:"scheduler",label:"Execução agendada",status:!schedulerSecretPresent?"warning":schedulerLastRun?.ok===true?"ok":"warning",detail:!schedulerSecretPresent?"O segredo de execução não foi encontrado no KV.":schedulerLastRun?.ok===true?"Segredo presente; a última execução registrada do Cron terminou com HTTP "+(schedulerLastRun.httpStatus||"200")+".": "Segredo presente, mas não há uma última execução bem-sucedida registrada."});
  let mediaDiagnostic=null;
  try {
   const raw=env.POSTFLOW3_KV?await env.POSTFLOW3_KV.get("system:instagram-media-diagnostic:last"):null;
   if(raw){const d=JSON.parse(raw);mediaDiagnostic={at:d.at||null,stage:String(d.stage||"").slice(0,40),reason:String(d.reason||"").slice(0,80),upstreamStatus:Number(d.upstreamStatus)||null,contentType:String(d.contentType||"").slice(0,80)};}
  }catch{}
  const warnings=checks.filter(x=>x.status!=="ok").length;
  return json({ok:true,checkedAt:new Date().toISOString(),summary:{total:checks.length,ok:checks.length-warnings,attention:warnings},checks,schedulerLastRun,mediaDiagnostic,note:"Verificação de configuração e último diagnóstico de mídia e Cron. Não revela segredos, tokens ou IDs de usuário; não substitui um teste de publicação ponta a ponta."});
 }catch(error){
  console.error("PostFlow3 admin health failure",error);
  return json({error:"Não foi possível verificar a saúde do sistema."},500);
 }
}

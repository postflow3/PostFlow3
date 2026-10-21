import { getSession, verifyStateCookie, encryptJson, userKey } from "../_lib/security.js";
function page(title,message,success=false){const t=title.replace(/[&<>"]/g,""),m=message.replace(/[&<>"]/g,"");return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t} — PostFlow3</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;color:#171735"><h1>${t}</h1><p>${m}</p><p><a href="/">Voltar ao PostFlow3</a></p><script>if(${success}){try{if(window.opener)window.opener.postMessage({type:"postflow3-instagram-connected"},window.location.origin)}catch(e){}}</script></body></html>`;}
export async function onRequestGet({request,env}){
 const url=new URL(request.url),p=url.searchParams;
 const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Set-Cookie":"pf3_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0"};
 const respond=(t,m,s=400,ok=false)=>new Response(page(t,m,ok),{status:s,headers});
 if(!env.POSTFLOW3_KV)return respond("Armazenamento não configurado","Configure o namespace KV POSTFLOW3_KV no Cloudflare Pages.",503);
 if(p.has("error"))return respond("Autorização cancelada","O Instagram não autorizou o acesso. Volte ao PostFlow3 e tente novamente.");
 const code=p.get("code"),state=p.get("state");
 if(!code||!state)return respond("Retorno inválido","O Instagram não enviou os dados necessários. Inicie a conexão novamente.");
 const session=await getSession(request,env);if(!session)return respond("Sessão expirada","Volte ao PostFlow3, entre novamente e repita a conexão.",401);
 if(!(await verifyStateCookie(request,env,state,session.userId)))return respond("Validação de segurança falhou","Não foi possível validar esta solicitação. Inicie a conexão novamente.");
 try{
  const id=env.INSTAGRAM_APP_ID,secret=env.INSTAGRAM_APP_SECRET;
  if(!id||!secret)return respond("Configuração incompleta","Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET nos secrets do Cloudflare Pages.",503);
  const redirectUri=env.INSTAGRAM_REDIRECT_URI||new URL("/api/instagram-callback",request.url).toString();
  const tr=await fetch("https://api.instagram.com/oauth/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:"authorization_code",redirect_uri:redirectUri,code})});
  const token=await tr.json();
  if(!tr.ok||!token.access_token)return respond("Não foi possível conectar","A Meta recusou a autorização. Confira o App ID, App Secret e URI de retorno.",502);
  let accessToken=token.access_token,expiresIn=Number(token.expires_in||3600);
  const longUrl=new URL("https://graph.instagram.com/access_token");longUrl.search=new URLSearchParams({grant_type:"ig_exchange_token",client_secret:secret,access_token:accessToken}).toString();
  const lr=await fetch(longUrl),longToken=await lr.json();
  if(lr.ok&&longToken.access_token){accessToken=longToken.access_token;expiresIn=Number(longToken.expires_in||5184000);}
  const profileUrl=new URL("https://graph.instagram.com/v23.0/me");profileUrl.search=new URLSearchParams({fields:"user_id,username",access_token:accessToken}).toString();
  const pr=await fetch(profileUrl),profile=await pr.json();
  if(!pr.ok||!profile.user_id)return respond("Autorização incompleta","Não foi possível ler o perfil. Verifique os produtos e permissões da Instagram API no painel da Meta.",502);
  await env.POSTFLOW3_KV.put(userKey(session.userId,"instagram-owner"),await encryptJson(env,{access_token:accessToken,expiry_date:Date.now()+expiresIn*1000,user_id:String(profile.user_id),username:profile.username||"",saved_at:Date.now()}));
  return respond("Instagram conectado!","A conta @"+(profile.username||"Instagram")+" foi autorizada e os dados foram guardados criptografados no servidor.",200,true);
 }catch{return respond("Erro na conexão","Confira os secrets, o armazenamento KV e as configurações do app da Meta. Nenhum token foi exibido.",500);}
}

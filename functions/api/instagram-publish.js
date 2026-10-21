import {getSession,decryptJson,userKey} from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function signature(env,key){
 const secret=env.POSTFLOW3_SESSION_SECRET;if(!secret)throw new Error("A configuração de assinatura do PostFlow3 está incompleta.");
 const cryptoKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode("instagram-media:"+key)));
 return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function onRequestPost({request,env}){
 const session=await getSession(request,env);if(!session)return json({error:"Sua sessão expirou. Entre novamente no PostFlow3."},401);
 if(!env.POSTFLOW3_KV||!env.POSTFLOW3_SESSION_SECRET)return json({error:"A configuração segura do Instagram/armazenamento está incompleta."},503);
 try{
  const input=await request.json(),videoKey=String(input.videoKey||""),caption=String(input.caption||"").trim().slice(0,2200),postId=String(input.postId||""),title=String(input.title||"Vídeo do Instagram").trim().slice(0,100),filename=String(input.filename||"video.mp4").trim().slice(0,200),size=Number(input.size)||0;
  if(!new RegExp("^instagram-media/"+session.userId+"/[0-9a-f-]{36}$","i").test(videoKey))return json({error:"O vídeo preparado para o Instagram não foi encontrado."},400);
  const raw=await env.POSTFLOW3_KV.get(userKey(session.userId,"instagram-owner"));if(!raw)return json({error:"Conecte o Instagram profissional antes de publicar."},400);
  const account=await decryptJson(env,raw);if(!account.access_token||!account.user_id)return json({error:"A conexão do Instagram expirou. Reconecte a conta."},401);
  const mediaUrl=new URL("/api/instagram-media",request.url);mediaUrl.searchParams.set("key",videoKey);mediaUrl.searchParams.set("sig",await signature(env,videoKey));
  const createResponse=await fetch("https://graph.instagram.com/v23.0/"+encodeURIComponent(account.user_id)+"/media",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({media_type:"REELS",video_url:mediaUrl.toString(),caption,access_token:account.access_token})});
  const created=await createResponse.json().catch(()=>({}));
  if(!createResponse.ok||!created.id){
   const metaError=created.error||{},metaCode=metaError.code!=null?String(metaError.code):"",metaSubcode=metaError.error_subcode!=null?String(metaError.error_subcode):"";
   const detail=[metaError.message||"A Meta não aceitou criar a publicação do Instagram.",metaCode?"Código Meta: "+metaCode:null,metaSubcode?"Subcódigo: "+metaSubcode:null].filter(Boolean).join(" | ");
   const blocked=/API access blocked/i.test(String(metaError.message||""))||metaCode==="200";
   return json({error:blocked?"A Meta está bloqueando o acesso da API do Instagram para esta conta ou aplicativo. O YouTube já foi enviado; não tente publicar novamente ainda. Confira os alertas e as permissões do app no Meta for Developers e, após liberar o acesso, reconecte o Instagram. Detalhe: "+detail:detail,instagramApiBlocked:blocked,metaCode:metaCode||null,metaSubcode:metaSubcode||null},502);
  }
  let ready=false,lastStatus="";
  for(let i=0;i<12;i++){
   const statusUrl=new URL("https://graph.instagram.com/v23.0/"+encodeURIComponent(created.id));
   statusUrl.searchParams.set("fields","status_code,status");statusUrl.searchParams.set("access_token",account.access_token);
   const statusResponse=await fetch(statusUrl),statusData=await statusResponse.json().catch(()=>({}));
   if(statusResponse.ok&&statusData.status_code==="FINISHED"){ready=true;break;}
   if(statusData.status_code==="ERROR")return json({error:statusData.status||"O Instagram não conseguiu processar o vídeo."},502);
   lastStatus=statusData.status||statusData.status_code||"processando";
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!ready)return json({error:"O Instagram ainda está processando o vídeo ("+lastStatus+"). Aguarde um pouco e tente novamente apenas se a publicação não aparecer no perfil."},202);
  const publishResponse=await fetch("https://graph.instagram.com/v23.0/"+encodeURIComponent(account.user_id)+"/media_publish",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:created.id,access_token:account.access_token})});
  const published=await publishResponse.json().catch(()=>({}));
  if(!publishResponse.ok||!published.id)return json({error:published.error?.message||"O Instagram não confirmou a publicação."},502);
  let permalink="";
  try{const pUrl=new URL("https://graph.instagram.com/v23.0/"+encodeURIComponent(published.id));pUrl.searchParams.set("fields","permalink");pUrl.searchParams.set("access_token",account.access_token);const p=await fetch(pUrl);const d=await p.json();permalink=d.permalink||"";}catch{}
  if(/^[0-9a-f-]{36}$/i.test(postId)){const stored=await env.POSTFLOW3_KV.get(userKey(session.userId,"post:"+postId),"json");if(stored){stored.instagramStatus="published";stored.instagramMediaId=published.id;stored.instagramPublishedAt=new Date().toISOString();if(permalink)stored.instagramUrl=permalink;await env.POSTFLOW3_KV.put(userKey(session.userId,"post:"+postId),JSON.stringify(stored));}}else{const standalone={id:crypto.randomUUID(),title,description:caption,filename,size,platforms:["Instagram"],status:"published_on_instagram",instagramStatus:"published",instagramMediaId:published.id,instagramUrl:permalink||null,instagramPublishedAt:new Date().toISOString(),createdAt:new Date().toISOString(),uploadedAt:new Date().toISOString()};await env.POSTFLOW3_KV.put(userKey(session.userId,"post:"+standalone.id),JSON.stringify(standalone));}
  await env.POSTFLOW3_KV.delete(userKey(session.userId,"instagram-drive:"+videoKey.split("/").pop()));
  return json({published:true,mediaId:published.id,permalink},200);
 }catch(e){return json({error:String(e?.message||"Falha ao publicar no Instagram.").slice(0,350)},500);}
}

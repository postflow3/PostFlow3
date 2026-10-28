import {getSession,decryptJson,userKey} from "../_lib/security.js";
import {getSocialAccount} from "../_lib/social-accounts.js";
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
  const input=await request.json(),accountId=String(input.accountId||"").trim().slice(0,180),videoKey=String(input.videoKey||""),caption=String(input.caption||"").trim().slice(0,2200),postId=String(input.postId||""),driveFileId=String(input.driveFileId||"").trim(),title=String(input.title||"Vídeo do Instagram").trim().slice(0,100),filename=String(input.filename||"video.mp4").trim().slice(0,200),size=Number(input.size)||0;
  if(!new RegExp("^instagram-media/"+session.userId+"/[0-9a-f-]{36}$","i").test(videoKey))return json({error:"O vídeo preparado para o Instagram não foi encontrado."},400);
  const account=await getSocialAccount(env,session.userId,"instagram",accountId);if(!account)return json({error:"Conecte ou selecione uma conta profissional do Instagram antes de publicar."},400);if(!account.access_token||!account.user_id)return json({error:"A conexão do Instagram expirou. Reconecte a conta."},401);
  const requestHost=new URL(request.url).hostname;const mediaOrigin=requestHost==="postflow3.pages.dev"?"https://postflow3.pages.dev":"https://cloudflare-migration.postflow3.pages.dev";const mediaUrl=new URL("/api/instagram-media",mediaOrigin);mediaUrl.searchParams.set("key",videoKey);mediaUrl.searchParams.set("sig",await signature(env,videoKey));
  const videoId=videoKey.split("/").pop();
  const mediaMetadataRaw=await env.POSTFLOW3_KV.get(userKey(session.userId,"instagram-drive:"+videoId));
  if(!mediaMetadataRaw)return json({error:"A foto ou vídeo não está mais disponível no armazenamento. Envie-o novamente."},404);
  const mediaMetadata=JSON.parse(mediaMetadataRaw),isPhoto=String(mediaMetadata.mimeType||"").toLowerCase()==="image/jpeg",mediaType=isPhoto?"IMAGE":"REELS";
  const pendingKey=userKey(session.userId,"instagram-pending:"+videoId+(accountId?":"+accountId:""));
  let pending=await env.POSTFLOW3_KV.get(pendingKey,"json");
  if(pending?.published){
   if(/^[0-9a-f-]{36}$/i.test(postId)){
    const stored=await env.POSTFLOW3_KV.get(userKey(session.userId,"post:"+postId),"json");
    if(stored){stored.instagramStatus="published";stored.instagramMediaType=pending.mediaType||stored.instagramMediaType||"REELS";stored.instagramAccountId=accountId||stored.instagramAccountId||null;if(driveFileId)stored.driveFileId=driveFileId;stored.instagramMediaId=pending.mediaId;stored.instagramPublishedAt=pending.publishedAt||new Date().toISOString();stored.instagramVideoKey=videoKey;if(pending.permalink)stored.instagramUrl=pending.permalink;if(!Array.isArray(stored.platforms))stored.platforms=["YouTube"];if(!stored.platforms.includes("Instagram"))stored.platforms.push("Instagram");await env.POSTFLOW3_KV.put(userKey(session.userId,"post:"+postId),JSON.stringify(stored));}
   }else if(pending.postRecordId){
    // The original standalone post record already exists; keep this retry idempotent.
   }else{
    const standalone={id:crypto.randomUUID(),title:pending.title||title,description:pending.caption||caption,filename:pending.filename||filename,size:Number(pending.size||size),driveFileId:pending.driveFileId||driveFileId||null,driveCleanupPending:true,driveCleanupGroup:videoKey,platforms:["Instagram"],status:"published_on_instagram",instagramStatus:"published",instagramAccountId:accountId||null,instagramMediaId:pending.mediaId,instagramVideoKey:videoKey,instagramUrl:pending.permalink||null,instagramPublishedAt:pending.publishedAt||new Date().toISOString(),createdAt:new Date().toISOString(),uploadedAt:new Date().toISOString()};
    await env.POSTFLOW3_KV.put(userKey(session.userId,"post:"+standalone.id),JSON.stringify(standalone));pending.postRecordId=standalone.id;await env.POSTFLOW3_KV.put(pendingKey,JSON.stringify(pending),{expirationTtl:30*86400});
   }
   return json({published:true,mediaId:pending.mediaId,permalink:pending.permalink||""},200);
  }
  let created;
  if(pending?.creationId){
   created={id:pending.creationId};
  }else{
   const createResponse=await fetch("https://graph.instagram.com/v23.0/"+encodeURIComponent(account.user_id)+"/media",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(isPhoto?{media_type:"IMAGE",image_url:mediaUrl.toString(),caption,access_token:account.access_token}:{media_type:"REELS",video_url:mediaUrl.toString(),caption,access_token:account.access_token})});
   created=await createResponse.json().catch(()=>({}));
   if(!createResponse.ok||!created.id){
    const metaError=created.error||{},metaCode=metaError.code!=null?String(metaError.code):"",metaSubcode=metaError.error_subcode!=null?String(metaError.error_subcode):"";
    const detail=[metaError.message||"A Meta não aceitou criar a publicação do Instagram.",metaCode?"Código Meta: "+metaCode:null,metaSubcode?"Subcódigo: "+metaSubcode:null].filter(Boolean).join(" | ");
    const blocked=/API access blocked/i.test(String(metaError.message||""))||metaCode==="200";
    return json({error:blocked?"A Meta está bloqueando o acesso da API do Instagram para esta conta ou aplicativo. O YouTube já foi enviado; não tente publicar novamente ainda. Confira os alertas e as permissões do app no Meta for Developers e, após liberar o acesso, reconecte o Instagram. Detalhe: "+detail:detail,instagramApiBlocked:blocked,metaCode:metaCode||null,metaSubcode:metaSubcode||null},502);
   }
   pending={creationId:created.id,videoKey,mediaType,driveFileId:driveFileId||null,caption,postId,title,filename,size,createdAt:new Date().toISOString()};
   await env.POSTFLOW3_KV.put(pendingKey,JSON.stringify(pending));
  }
  // Persist the immediate post before waiting for Meta processing, so the cloud
  // scheduler can resume polling even if the browser closes or the request times out.
  if(!pending.postRecordId){
   const now=new Date().toISOString();
   const recordId=/^[0-9a-f-]{36}$/i.test(postId)?postId:crypto.randomUUID();
   const recordKey=userKey(session.userId,"post:"+recordId);
   const stored=await env.POSTFLOW3_KV.get(recordKey,"json");
   const platforms=Array.isArray(stored?.platforms)?[...stored.platforms]:[];
   if(!platforms.includes("Instagram"))platforms.push("Instagram");
   const postRecord={
    ...(stored||{}),id:recordId,title:stored?.title||title,description:stored?.description||caption,
    filename:stored?.filename||filename,size:Number(stored?.size||size),driveFileId:stored?.driveFileId||driveFileId||null,
    driveCleanupPending:true,driveCleanupGroup:stored?.driveCleanupGroup||videoKey,platforms,instagramMediaType:mediaType,
    publicationMode:stored?.publicationMode||"immediate",scheduledAt:stored?.scheduledAt||null,
    status:stored?.status||(platforms.includes("YouTube")?"published_on_youtube":"publishing"),
    instagramStatus:"processing",instagramAccountId:accountId||null,instagramVideoKey:videoKey,
    instagramCreationId:created.id,instagramAttemptedAt:now,instagramError:null,
    createdAt:stored?.createdAt||now,uploadedAt:stored?.uploadedAt||now
   };
   await env.POSTFLOW3_KV.put(recordKey,JSON.stringify(postRecord));
   pending.postRecordId=recordId;
   await env.POSTFLOW3_KV.put(pendingKey,JSON.stringify(pending),{expirationTtl:30*86400});
  }
  // Instagram IMAGE containers can be published directly; status polling is required for video/Reels processing.
  let ready=mediaType==="IMAGE",lastStatus="";
  if(mediaType!=="IMAGE"){
   for(let i=0;i<12;i++){
    const statusUrl=new URL("https://graph.instagram.com/v23.0/"+encodeURIComponent(created.id));
    statusUrl.searchParams.set("fields","status_code,status,error_message");statusUrl.searchParams.set("access_token",account.access_token);
    const statusResponse=await fetch(statusUrl),statusData=await statusResponse.json().catch(()=>({}));
    if(statusResponse.ok&&statusData.status_code==="FINISHED"){ready=true;break;}
    if(statusData.status_code==="ERROR"){await env.POSTFLOW3_KV.delete(pendingKey);return json({error:String(statusData.error_message||statusData.status||"O Instagram não conseguiu processar o vídeo."),instagramStatus:statusData.status_code},502);}
    lastStatus=statusData.status||statusData.status_code||"processando";
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(!ready)return json({pending:true,error:"O Instagram ainda está processando o vídeo ("+lastStatus+"). O PostFlow3 continuará verificando sem criar outra publicação."},202);
  }
  const publishResponse=await fetch("https://graph.instagram.com/v23.0/"+encodeURIComponent(account.user_id)+"/media_publish",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:created.id,access_token:account.access_token})});
  const published=await publishResponse.json().catch(()=>({}));
  if(!publishResponse.ok||!published.id)return json({error:published.error?.message||"O Instagram não confirmou a publicação."},502);
  let permalink="";
  try{const pUrl=new URL("https://graph.instagram.com/v23.0/"+encodeURIComponent(published.id));pUrl.searchParams.set("fields","permalink");pUrl.searchParams.set("access_token",account.access_token);const p=await fetch(pUrl);const d=await p.json();permalink=d.permalink||"";}catch{}
  pending.published=true;pending.mediaId=published.id;pending.permalink=permalink;pending.publishedAt=new Date().toISOString();await env.POSTFLOW3_KV.put(pendingKey,JSON.stringify(pending));
  if(pending.postRecordId){
   const recordKey=userKey(session.userId,"post:"+pending.postRecordId);
   const stored=await env.POSTFLOW3_KV.get(recordKey,"json");
   if(stored){
    stored.instagramStatus="published";stored.instagramMediaType=mediaType;if(driveFileId)stored.driveFileId=driveFileId;stored.instagramMediaId=published.id;
    stored.instagramAccountId=accountId||stored.instagramAccountId||null;stored.instagramPublishedAt=new Date().toISOString();
    stored.instagramVideoKey=videoKey;stored.instagramCreationId=null;stored.instagramError=null;
    if(permalink)stored.instagramUrl=permalink;
    if(!Array.isArray(stored.platforms))stored.platforms=[];
    if(!stored.platforms.includes("Instagram"))stored.platforms.push("Instagram");
    if(!stored.platforms.includes("YouTube"))stored.status="published_on_instagram";
    await env.POSTFLOW3_KV.put(recordKey,JSON.stringify(stored));
   }
  }
  await env.POSTFLOW3_KV.put(pendingKey,JSON.stringify(pending),{expirationTtl:30*86400});
  return json({published:true,mediaId:published.id,permalink},200);
 }catch(e){return json({error:String(e?.message||"Falha ao publicar no Instagram.").slice(0,350)},500);}
}

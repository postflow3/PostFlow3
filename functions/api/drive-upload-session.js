import { getSession, decryptJson, encryptJson, userKey } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function accessToken(env,userId){
 const raw=await env.POSTFLOW3_KV.get(userKey(userId,"youtube-owner"));
 if(!raw)throw new Error("Conecte novamente sua conta Google.");
 let t=await decryptJson(env,raw);
 const exp=Number(t.expiry_date||((t.saved_at||0)+Number(t.expires_in||0)*1000));
 if(t.access_token&&exp>Date.now()+60000)return t.access_token;
 if(!t.refresh_token)throw new Error("A conexão Google precisa ser renovada. Reconecte a conta.");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:t.refresh_token,grant_type:"refresh_token"})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw new Error("Não foi possível renovar a autorização Google.");
 t={...t,...d,refresh_token:t.refresh_token,expiry_date:Date.now()+Number(d.expires_in||3600)*1000,saved_at:Date.now()};
 await env.POSTFLOW3_KV.put(userKey(userId,"youtube-owner"),await encryptJson(env,t));
 return t.access_token;
}
export async function onRequestPost({request,env}){
 const s=await getSession(request,env);if(!s)return json({error:"Entre novamente no PostFlow3."},401);
 if(!env.POSTFLOW3_KV||!env.TOKEN_ENCRYPTION_KEY||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:"A configuração segura do Google está incompleta."},503);
 try{
  const i=await request.json(),filename=String(i.filename||"video.mp4").slice(0,200),mimeType=String(i.mimeType||"video/mp4").toLowerCase(),size=Number(i.size);
  if(!Number.isSafeInteger(size)||size<1||!mimeType.startsWith("video/"))return json({error:"Arquivo de vídeo inválido."},400);
  const token=await accessToken(env,s.userId);
  const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Type":mimeType,"X-Upload-Content-Length":String(size)},body:JSON.stringify({name:filename,mimeType})});
  const uploadUrl=r.headers.get("Location"),d=await r.json().catch(()=>({}));
  if(!r.ok||!uploadUrl)return json({error:d.error?.message||"O Google Drive não aceitou salvar a cópia do vídeo. Reconecte a conta Google e confira a permissão de arquivos."},502);
  const uploadId=crypto.randomUUID(),pending={uploadId,uploadUrl,filename,mimeType,size,createdAt:Date.now()};
  await env.POSTFLOW3_KV.put(userKey(s.userId,"drive-upload:"+uploadId),await encryptJson(env,pending),{expirationTtl:86400});
  return json({uploadId,chunkSize:8388608},201);
 }catch(e){return json({error:String(e?.message||"Não foi possível iniciar o salvamento no Drive.").slice(0,300)},500);}
}
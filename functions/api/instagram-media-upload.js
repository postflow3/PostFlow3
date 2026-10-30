import { getSession, decryptJson, encryptJson, userKey } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function googleToken(env,userId){
 const key=userKey(userId,"youtube-owner"),raw=await env.POSTFLOW3_KV.get(key);
 if(!raw)throw new Error("Conecte novamente sua conta Google para habilitar o armazenamento no Drive.");
 let t=await decryptJson(env,raw),exp=Number(t.expiry_date||((t.saved_at||0)+Number(t.expires_in||0)*1000));
 if(t.access_token&&exp>Date.now()+60000)return t.access_token;
 if(!t.refresh_token)throw new Error("Reconecte sua conta Google para salvar vídeos no Drive.");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:t.refresh_token,grant_type:"refresh_token"})}),d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw new Error("Não foi possível renovar a autorização Google. Reconecte a conta.");
 t={...t,...d,refresh_token:t.refresh_token,expiry_date:Date.now()+Number(d.expires_in||3600)*1000,saved_at:Date.now()};
 await env.POSTFLOW3_KV.put(key,await encryptJson(env,t));return t.access_token;
}
export async function onRequestPost({request,env}){
 const session=await getSession(request,env);if(!session)return json({error:"Entre novamente no PostFlow3."},401);
 if(!env.POSTFLOW3_KV||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:"Configure a conexão Google no Cloudflare Pages."},503);
 try{
  const form=await request.formData(),file=form.get("video");
  if(!(file instanceof File)||!file.size)return json({error:"Selecione um vídeo."},400);
  const isPhoto=file.type==="image/jpeg";
  if(isPhoto&&file.size>20*1024*1024)return json({error:"A foto precisa ter até 20 MB."},413);
  if(!isPhoto&&file.size>80*1024*1024)return json({error:"O vídeo precisa ter até 80 MB para o Instagram."},413);
  if(!isPhoto&&!/^video\/(mp4|quicktime|webm)$/.test(file.type))return json({error:"Use uma foto JPG/JPEG ou um vídeo MP4, MOV ou WebM."},400);
  const token=await googleToken(env,session.userId);
  const init=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Type":file.type,"X-Upload-Content-Length":String(file.size)},body:JSON.stringify({name:String(file.name||"video.mp4").slice(0,200),mimeType:file.type})});
  const uploadUrl=init.headers.get("Location"),initData=await init.json().catch(()=>({}));
  if(!init.ok||!uploadUrl)return json({error:initData.error?.message||"O Google Drive não conseguiu iniciar o salvamento. Reconecte a conta Google e autorize o acesso aos arquivos."},502);
  const saved=await fetch(uploadUrl,{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":file.type,"Content-Length":String(file.size),"Content-Range":"bytes 0-"+(file.size-1)+"/"+file.size},body:file});
  const d=await saved.json().catch(()=>({}));
  if(!saved.ok||!d.id)return json({error:d.error?.message||"O Google Drive não confirmou o salvamento do vídeo. Tente um vídeo menor ou reconecte a conta Google."},502);
  const videoKey="instagram-media/"+session.userId+"/"+crypto.randomUUID();
  await env.POSTFLOW3_KV.put(userKey(session.userId,"instagram-drive:"+videoKey.split("/").pop()),JSON.stringify({fileId:d.id,mimeType:d.mimeType||file.type,size:Number(d.size||file.size),createdAt:Date.now()}));
  return json({videoKey,driveFileId:d.id,storedIn:"Google Drive",size:Number(d.size||file.size),mediaType:isPhoto?"IMAGE":"REELS",mimeType:d.mimeType||file.type},201);
 }catch(e){return json({error:String(e?.message||"Não foi possível salvar o vídeo no Google Drive.").slice(0,300)},500);}
}

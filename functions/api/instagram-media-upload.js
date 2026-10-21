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
  if(file.size>80*1024*1024)return json({error:"O vídeo precisa ter até 80 MB para o Instagram."},413);
  if(!/^video\/(mp4|quicktime|webm)$/.test(file.type))return json({error:"Para publicar no Instagram, use MP4, MOV ou WebM."},400);
  const token=await googleToken(env,session.userId),body=new FormData();
  body.append("metadata",new Blob([JSON.stringify({name:String(file.name||"video.mp4").slice(0,200),mimeType:file.type})],{type:"application/json"}));
  body.append("file",file,file.name||"video.mp4");
  const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size",{method:"POST",headers:{Authorization:"Bearer "+token},body}),d=await r.json().catch(()=>({}));
  if(!r.ok||!d.id)return json({error:d.error?.message||"O Google Drive não conseguiu guardar o vídeo. Reconecte a conta Google e autorize o acesso aos arquivos."},502);
  const videoKey="instagram-media/"+session.userId+"/"+crypto.randomUUID();
  await env.POSTFLOW3_KV.put(userKey(session.userId,"instagram-drive:"+videoKey.split("/").pop()),JSON.stringify({fileId:d.id,mimeType:d.mimeType||file.type,size:Number(d.size||file.size),createdAt:Date.now()}),{expirationTtl:7*86400});
  return json({videoKey,storedIn:"Google Drive",size:Number(d.size||file.size)},201);
 }catch(e){return json({error:String(e?.message||"Não foi possível salvar o vídeo no Google Drive.").slice(0,300)},500);}
}

import { getSession, decryptJson, encryptJson, userKey } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const s=await getSession(request,env);if(!s)return json({error:"Entre novamente no PostFlow3."},401);
 if(!env.POSTFLOW3_KV||!env.TOKEN_ENCRYPTION_KEY||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:"A configuração segura do Google está incompleta."},503);
 try{
  const id=request.headers.get("X-PostFlow-Drive-Upload-Id")||"",start=Number(request.headers.get("X-Chunk-Start")),end=Number(request.headers.get("X-Chunk-End")),total=Number(request.headers.get("X-Upload-Total"));
  if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!Number.isSafeInteger(total)||start<0||end<start||end>=total)return json({error:"Trecho inválido."},400);
  const key=userKey(s.userId,"drive-upload:"+id),raw=await env.POSTFLOW3_KV.get(key);if(!raw)return json({error:"Sessão de salvamento no Drive expirada."},404);
  const p=await decryptJson(env,raw),bytes=await request.arrayBuffer();if(p.uploadId!==id||p.size!==total||bytes.byteLength!==end-start+1||bytes.byteLength>8388608)return json({error:"O trecho não corresponde ao vídeo selecionado."},400);
  let t=await decryptJson(env,await env.POSTFLOW3_KV.get(userKey(s.userId,"youtube-owner")));
  const exp=Number(t.expiry_date||((t.saved_at||0)+Number(t.expires_in||0)*1000));
  if(!t.access_token||exp<Date.now()+60000){
   if(!t.refresh_token)throw new Error("Reconecte a conta Google para salvar vídeos no Drive.");
   const rr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:t.refresh_token,grant_type:"refresh_token"})}),nd=await rr.json().catch(()=>({}));
   if(!rr.ok||!nd.access_token)throw new Error("Não foi possível renovar a autorização Google.");
   t={...t,...nd,refresh_token:t.refresh_token,expiry_date:Date.now()+Number(nd.expires_in||3600)*1000,saved_at:Date.now()};await env.POSTFLOW3_KV.put(userKey(s.userId,"youtube-owner"),await encryptJson(env,t));
  }
  const r=await fetch(p.uploadUrl,{method:"PUT",headers:{Authorization:"Bearer "+t.access_token,"Content-Type":p.mimeType,"Content-Length":String(bytes.byteLength),"Content-Range":"bytes "+start+"-"+end+"/"+total},body:bytes});
  if(r.status===308){const range=r.headers.get("Range")||"",m=range.match(/bytes=0-(\d+)/);return json({complete:false,nextOffset:m?Number(m[1])+1:end+1});}
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.id)return json({error:d.error?.message||"O Drive não confirmou o salvamento do vídeo."},502);
  await env.POSTFLOW3_KV.delete(key);
  return json({complete:true,file:{id:d.id,name:d.name||p.filename,mimeType:d.mimeType||p.mimeType,size:Number(d.size||p.size),webViewLink:d.webViewLink||("https://drive.google.com/file/d/"+d.id+"/view")}},201);
 }catch(e){return json({error:String(e?.message||"Erro ao salvar vídeo no Drive.").slice(0,300)},500);}
}
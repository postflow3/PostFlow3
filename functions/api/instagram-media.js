import { decryptJson, encryptJson, userKey } from "../_lib/security.js";
function notFound(){return new Response("Not found",{status:404,headers:{"Cache-Control":"no-store"}});}
async function signature(env,key){
 const secret=env.POSTFLOW3_SESSION_SECRET;if(!secret)return "";
 const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode("instagram-media:"+key)));
 return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function token(env,userId){
 const k=userKey(userId,"youtube-owner"),raw=await env.POSTFLOW3_KV.get(k);if(!raw)throw new Error("Google token missing");
 let t=await decryptJson(env,raw),exp=Number(t.expiry_date||((t.saved_at||0)+Number(t.expires_in||0)*1000));
 if(t.access_token&&exp>Date.now()+60000)return t.access_token;
 if(!t.refresh_token)throw new Error("Google refresh token missing");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:t.refresh_token,grant_type:"refresh_token"})}),d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw new Error("Google token refresh failed");
 t={...t,...d,refresh_token:t.refresh_token,expiry_date:Date.now()+Number(d.expires_in||3600)*1000,saved_at:Date.now()};await env.POSTFLOW3_KV.put(k,await encryptJson(env,t));return t.access_token;
}
export async function onRequestGet({request,env}){
 try{
  const u=new URL(request.url),key=u.searchParams.get("key")||"",sig=u.searchParams.get("sig")||"",m=key.match(/^instagram-media\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
  if(!m||!sig||sig!==await signature(env,key)||!env.POSTFLOW3_KV)return notFound();
  const [,userId,id]=m,raw=await env.POSTFLOW3_KV.get(userKey(userId,"instagram-drive:"+id));if(!raw)return notFound();
  const meta=JSON.parse(raw),access=await token(env,userId),headers={Authorization:"Bearer "+access};
  const upstream=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(meta.fileId)+"?alt=media",{headers});
  if(!upstream.ok||!upstream.body)return notFound();
  const outHeaders=new Headers({"Content-Type":meta.mimeType||"video/mp4","Cache-Control":"public, max-age=300","X-Content-Type-Options":"nosniff"});
  const len=upstream.headers.get("Content-Length")||String(meta.size||"");if(len)outHeaders.set("Content-Length",len);
  return new Response(upstream.body,{headers:outHeaders});
 }catch{return notFound();}
}

function jsonError(){return new Response("Not found",{status:404,headers:{"Cache-Control":"no-store"}});}
async function signature(env,key){
 const secret=env.POSTFLOW3_SESSION_SECRET;if(!secret)return "";
 const cryptoKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode("instagram-media:"+key)));
 return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function onRequestGet({request,env}){
 try{
  const url=new URL(request.url),key=url.searchParams.get("key")||"",sig=url.searchParams.get("sig")||"";
  if(!env.POSTFLOW3_MEDIA||!/^instagram-media\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key)||!sig||sig!==await signature(env,key))return jsonError();
  const object=await env.POSTFLOW3_MEDIA.get(key);if(!object)return jsonError();
  const headers=new Headers({"Cache-Control":"public, max-age=3600","Content-Type":object.httpMetadata?.contentType||"video/mp4","Content-Length":String(object.size),"Accept-Ranges":"bytes"});
  if(object.httpEtag)headers.set("ETag",object.httpEtag);
  return new Response(object.body,{headers});
 }catch{return jsonError();}
}

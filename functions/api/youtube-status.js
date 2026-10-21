import { getSession, userKey, decryptJson } from "../_lib/security.js";
export async function onRequestGet({request,env}){
 const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
 const session=await getSession(request,env);if(!session)return new Response(JSON.stringify({error:"Não autenticado."}),{status:401,headers});
 if(!env.POSTFLOW3_KV)return new Response(JSON.stringify({error:"Armazenamento não configurado."}),{status:503,headers});
 try{const raw=await env.POSTFLOW3_KV.get(userKey(session.userId,"youtube-owner"));if(!raw)return new Response(JSON.stringify({connected:false}),{status:200,headers});const tokens=await decryptJson(env,raw);return new Response(JSON.stringify({connected:Boolean(tokens.access_token||tokens.refresh_token)}),{status:200,headers});}
 catch{return new Response(JSON.stringify({connected:false,error:"Não foi possível verificar a conexão."}),{status:500,headers});}
}

import { getSession, userKey, decryptJson } from "../_lib/security.js";
export async function onRequestGet({request,env}){
 const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
 const session=await getSession(request,env);if(!session)return Response.json({error:"Faça login novamente."},{status:401,headers});
 try{if(!env.POSTFLOW3_KV)return Response.json({connected:false,error:"Armazenamento não configurado."},{status:503,headers});const raw=await env.POSTFLOW3_KV.get(userKey(session.userId,"instagram-owner"));if(!raw)return Response.json({connected:false},{headers});const data=await decryptJson(env,raw);if(!data.access_token||!data.user_id)return Response.json({connected:false},{headers});return Response.json({connected:true,username:data.username||""},{headers});}
 catch{return Response.json({connected:false,error:"Não foi possível verificar a conexão."},{status:500,headers});}
}

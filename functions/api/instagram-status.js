import { getSession, userKey, decryptJson } from "../_lib/security.js";
export async function onRequestGet({request,env}){
 const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
 const session=await getSession(request,env);if(!session)return Response.json({error:"Faça login novamente."},{status:401,headers});
 try{
  if(!env.POSTFLOW3_KV)return Response.json({connected:false,error:"Armazenamento não configurado."},{status:503,headers});
  const raw=await env.POSTFLOW3_KV.get(userKey(session.userId,"instagram-owner"));
  if(!raw)return Response.json({connected:false},{headers});
  const data=await decryptJson(env,raw);
  if(!data.access_token||!data.user_id)return Response.json({connected:false},{headers});
  const result={connected:true,username:data.username||""};
  try{
   const profileUrl=new URL("https://graph.instagram.com/v23.0/"+encodeURIComponent(data.user_id));
   profileUrl.search=new URLSearchParams({fields:"user_id,username,followers_count,media_count",access_token:data.access_token}).toString();
   const response=await fetch(profileUrl,{headers:{"Accept":"application/json"}});
   const profile=await response.json();
   if(response.ok){
    if(profile.username)result.username=profile.username;
    if(Number.isFinite(Number(profile.followers_count)))result.followersCount=Number(profile.followers_count);
    if(Number.isFinite(Number(profile.media_count)))result.mediaCount=Number(profile.media_count);
   }else{
    result.metricsAvailable=false;
    result.metricsMessage=String(profile.error?.message||"A API do Instagram não liberou as métricas desta conta.").slice(0,180);
   }
  }catch{result.metricsAvailable=false;result.metricsMessage="Não foi possível consultar as métricas do Instagram agora."}
  return Response.json(result,{headers});
 }catch{return Response.json({connected:false,error:"Não foi possível verificar a conexão."},{status:500,headers});}
}

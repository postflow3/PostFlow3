import { getSession, userKey, decryptJson, encryptJson } from "../_lib/security.js";
export async function onRequestGet({request,env}){
 const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
 const session=await getSession(request,env);if(!session)return new Response(JSON.stringify({error:"Não autenticado."}),{status:401,headers});
 if(!env.POSTFLOW3_KV)return new Response(JSON.stringify({error:"Armazenamento não configurado."}),{status:503,headers});
 try{
  const key=userKey(session.userId,"youtube-owner");
  const raw=await env.POSTFLOW3_KV.get(key);
  if(!raw)return new Response(JSON.stringify({connected:false}),{status:200,headers});
  const tokens=await decryptJson(env,raw);
  if(!tokens.access_token&&!tokens.refresh_token)return new Response(JSON.stringify({connected:false}),{status:200,headers});
  let accessToken=tokens.access_token;
  if(tokens.expiry_date&&Number(tokens.expiry_date)<Date.now()+60000&&tokens.refresh_token&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET){
   const refreshed=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})});
   const fresh=await refreshed.json();
   if(refreshed.ok&&fresh.access_token){accessToken=fresh.access_token;const updated={...tokens,...fresh,refresh_token:tokens.refresh_token,expiry_date:Date.now()+Number(fresh.expires_in||3600)*1000};await env.POSTFLOW3_KV.put(key,await encryptJson(env,updated));}
  }
  const result={connected:true};
  try{
   const response=await fetch("https://youtube.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}});
   const data=await response.json();
   if(response.ok&&data.items?.length){
    const channel=data.items[0],stats=channel.statistics||{};
    if(stats.subscriberCount!==undefined)result.subscriberCount=Number(stats.subscriberCount);
    result.hiddenSubscriberCount=Boolean(stats.hiddenSubscriberCount);
    result.channelTitle=channel.snippet?.title||"";
    result.channelId=channel.id||"";
   }else{
    result.metricsAvailable=false;
    result.metricsMessage=String(data.error?.message||"O Google não retornou as estatísticas do canal.").slice(0,180);
    if(data.error?.code===401)result.reconnectRequired=true;
   }
  }catch{result.metricsAvailable=false;result.metricsMessage="Não foi possível consultar os inscritos do YouTube agora."}
  return new Response(JSON.stringify(result),{status:200,headers});
 }catch{return new Response(JSON.stringify({connected:false,error:"Não foi possível verificar a conexão."}),{status:500,headers});}
}

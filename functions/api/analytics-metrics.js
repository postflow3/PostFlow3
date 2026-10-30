import { getSession, userKey, decryptJson, encryptJson } from "../_lib/security.js";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function youtubeToken(env,userId){
 const key=userKey(userId,"youtube-owner"),raw=await env.POSTFLOW3_KV.get(key);
 if(!raw)return null;
 let t=await decryptJson(env,raw),expiry=Number(t.expiry_date||((t.saved_at||0)+Number(t.expires_in||0)*1000));
 if(t.access_token&&expiry>Date.now()+60000)return t.access_token;
 if(!t.refresh_token||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return null;
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:t.refresh_token,grant_type:"refresh_token"})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)return null;
 t={...t,...d,refresh_token:t.refresh_token,expiry_date:Date.now()+Number(d.expires_in||3600)*1000,saved_at:Date.now()};
 await env.POSTFLOW3_KV.put(key,await encryptJson(env,t));
 return t.access_token;
}
export async function onRequestGet({request,env}){
 const session=await getSession(request,env);
 if(!session)return json({error:"Sua sessão expirou. Entre novamente."},401);
 if(!env.POSTFLOW3_KV)return json({error:"Armazenamento não configurado."},503);
 try{
  const prefix=userKey(session.userId,"post:"),listed=await env.POSTFLOW3_KV.list({prefix,limit:100});
  const posts=[];
  for(const k of listed.keys){const p=await env.POSTFLOW3_KV.get(k.name,"json");if(p)posts.push(p);}
  const published=posts.filter(p=>/publicad|published|success|conclu/i.test(String(p.status||""))&&!/falha|erro|scheduled|agendad/i.test(String(p.status||"")));
  const results=[],platforms={youtube:{connected:false,available:false,message:"Conecte o YouTube para consultar as métricas.",videos:[]},instagram:{connected:false,available:false,message:"Conecte o Instagram profissional para consultar as métricas.",videos:[]}};
  const ytRaw=await env.POSTFLOW3_KV.get(userKey(session.userId,"youtube-owner"));
  if(ytRaw){
   platforms.youtube.connected=true;
   const token=await youtubeToken(env,session.userId);
   if(token){
    const ids=[...new Set(published.map(p=>String(p.youtubeVideoId||"")).filter(id=>/^[\w-]{6,30}$/.test(id)))];
    if(ids.length){
     const map={};let errorMessage="";
     for(let i=0;i<ids.length;i+=50){
      const u=new URL("https://youtube.googleapis.com/youtube/v3/videos");u.search=new URLSearchParams({part:"snippet,statistics",id:ids.slice(i,i+50).join(",")}).toString();
      const r=await fetch(u,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){errorMessage=String(d.error?.message||"O YouTube não liberou as estatísticas.").slice(0,180);break;}
      for(const v of d.items||[])map[v.id]={id:v.id,title:v.snippet?.title||"",thumbnail:v.snippet?.thumbnails?.medium?.url||v.snippet?.thumbnails?.default?.url||"",url:"https://www.youtube.com/watch?v="+v.id,views:Number(v.statistics?.viewCount||0),likes:Number(v.statistics?.likeCount||0),comments:Number(v.statistics?.commentCount||0)};
     }
     if(!errorMessage){platforms.youtube.available=true;platforms.youtube.message="Dados atuais fornecidos pelo YouTube.";platforms.youtube.videos=published.filter(p=>p.youtubeVideoId&&map[p.youtubeVideoId]).map(p=>({...map[p.youtubeVideoId],postId:p.id,postTitle:p.title||map[p.youtubeVideoId].title,publishedAt:p.publishedAt||p.youtubePublishedAt||p.uploadedAt||p.createdAt||null,platform:"YouTube"}));}
     else platforms.youtube.message=errorMessage;
    }else platforms.youtube.message="Ainda não há vídeos publicados com ID do YouTube registrado no histórico.";
   }else platforms.youtube.message="Não foi possível renovar a autorização do YouTube. Reconecte a conta e confirme a permissão de leitura.";
  }
  const igRaw=await env.POSTFLOW3_KV.get(userKey(session.userId,"instagram-owner"));
  if(igRaw){
   platforms.instagram.connected=true;
   const account=await decryptJson(env,igRaw),items=published.filter(p=>p.instagramMediaId);
   if(items.length){
    let any=false,lastError="";
    for(const p of items.slice(0,50)){
     try{
      const u=new URL("https://graph.instagram.com/v23.0/"+encodeURIComponent(p.instagramMediaId)+"/insights");
      u.search=new URLSearchParams({metric:"views,reach,likes,comments,saved,shares",access_token:account.access_token}).toString();
      const r=await fetch(u,{headers:{Accept:"application/json"}}),d=await r.json().catch(()=>({}));
      if(!r.ok){lastError=String(d.error?.message||"A Meta não liberou as métricas para esta mídia.").slice(0,180);continue;}
      const values={};for(const metric of d.data||[])values[metric.name]=Number(metric.values?.[0]?.value||0);
      any=true;platforms.instagram.videos.push({id:p.instagramMediaId,postId:p.id,postTitle:p.title||p.filename||"Vídeo do Instagram",publishedAt:p.instagramPublishedAt||p.publishedAt||p.uploadedAt||p.createdAt||null,url:p.instagramUrl||"",views:values.views??null,reach:values.reach??null,likes:values.likes??null,comments:values.comments??null,saved:values.saved??null,shares:values.shares??null,platform:"Instagram"});
     }catch{lastError="Não foi possível consultar as métricas do Instagram agora."}
    }
    platforms.instagram.available=any;
    platforms.instagram.message=any?"Dados atuais fornecidos pela API do Instagram.":(lastError||"A API não retornou métricas para os vídeos registrados.");
   }else platforms.instagram.message="Ainda não há IDs de mídias publicadas do Instagram no histórico.";
  }
  return json({updatedAt:new Date().toISOString(),platforms});
 }catch{return json({error:"Não foi possível consultar as métricas agora. Tente novamente."},500);}
}

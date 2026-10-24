import { getSession, userKey } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const safe=(v,max)=>String(v||"").trim().slice(0,max);
export async function onRequestGet({request,env}){
 const session=await getSession(request,env);if(!session)return json({error:"Faça login novamente."},401);
 if(!env.POSTFLOW3_KV)return json({error:"Armazenamento KV não configurado."},503);
 try{
  const prefix=userKey(session.userId,"post:");
  const list=await env.POSTFLOW3_KV.list({prefix,limit:100}),posts=[];
  for(const key of list.keys){const value=await env.POSTFLOW3_KV.get(key.name,"json");if(value)posts.push(value)}
  posts.sort((a,b)=>(a.scheduledAt||"").localeCompare(b.scheduledAt||""));
  return json({posts});
 }catch{return json({error:"Não foi possível carregar a fila."},500)}
}
export async function onRequestPost({request,env}){
 const session=await getSession(request,env);if(!session)return json({error:"Faça login novamente."},401);
 if(!env.POSTFLOW3_KV||!env.POSTFLOW3_MEDIA)return json({error:"Armazenamento de fila ou vídeos não está configurado."},503);
 try{
  const form=await request.formData(),file=form.get("video"),title=safe(form.get("title"),100),description=safe(form.get("description"),5000),scheduledAt=safe(form.get("scheduledAt"),40);
  if(!(file instanceof File)||!file.size)return json({error:"Selecione um arquivo de vídeo."},400);
  if(file.size>80*1024*1024)return json({error:"O vídeo precisa ter até 80 MB nesta versão."},413);
  if(!/^video\/(mp4|quicktime|webm)$/.test(file.type))return json({error:"Formato não aceito. Use MP4, MOV ou WebM."},400);
  if(!title)return json({error:"Digite um título."},400);
  const date=new Date(scheduledAt);if(!scheduledAt||Number.isNaN(date.getTime())||date.getTime()<Date.now()+60_000)return json({error:"Escolha uma data e horário pelo menos 1 minuto no futuro."},400);
  const id=crypto.randomUUID(),key=userKey(session.userId,"videos/"+id);
  await env.POSTFLOW3_MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
  const post={id,title,description,filename:safe(file.name,200),mimeType:file.type,size:file.size,videoKey:key,scheduledAt:date.toISOString(),status:"scheduled",createdAt:new Date().toISOString(),platforms:["YouTube"]};
  await env.POSTFLOW3_KV.put(userKey(session.userId,"post:"+id),JSON.stringify(post));
  return json({post},201);
 }catch{return json({error:"Não foi possível salvar o vídeo. Tente um arquivo menor."},500)}
}

export async function onRequestDelete({request,env}){
 const session=await getSession(request,env);if(!session)return json({error:"Faça login novamente."},401);
 if(!env.POSTFLOW3_KV)return json({error:"Armazenamento KV não configurado."},503);
 try{
  const body=await request.json().catch(()=>({}));
  const requestedId=String(body.id||"").trim();
  const prefix=userKey(session.userId,"post:");
  if(requestedId){
   const key=userKey(session.userId,"post:"+requestedId);
   const post=await env.POSTFLOW3_KV.get(key,"json");
   if(!post)return json({error:"Esse agendamento não foi encontrado."},404);
   const status=String(post.status||"").toLowerCase();
   const pending=["scheduled","agendado","queued","pending","pendente","na fila","em fila"].includes(status);
   if(!pending)return json({error:"Só é possível cancelar itens que ainda estão aguardando publicação."},409);
   if(env.POSTFLOW3_MEDIA&&post.videoKey)await env.POSTFLOW3_MEDIA.delete(post.videoKey);
   await env.POSTFLOW3_KV.delete(key);
   return json({ok:true,cancelled:1,message:"Agendamento cancelado."});
  }
  const list=await env.POSTFLOW3_KV.list({prefix,limit:100});
  let cancelled=0,failed=0;
  for(const item of list.keys){
   const key=item.name;
   const post=await env.POSTFLOW3_KV.get(key,"json");
   if(!post)continue;
   const status=String(post.status||"").toLowerCase();
   const pending=(status==="scheduled"||status==="agendado"||status==="queued"||status==="pending"||status==="pendente"||status==="na fila"||status==="em fila");
   if(!pending)continue;
   try{
    if(env.POSTFLOW3_MEDIA&&post.videoKey)await env.POSTFLOW3_MEDIA.delete(post.videoKey);
    await env.POSTFLOW3_KV.delete(key);
    cancelled++;
   }catch{failed++;}
  }
  return json({ok:true,cancelled,failed,message:cancelled?"Agendamentos cancelados.":"Nenhum agendamento pendente encontrado."});
 }catch{return json({error:"Não foi possível limpar os agendamentos."},500)}
}

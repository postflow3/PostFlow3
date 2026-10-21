import { hasSession } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 if(!(await hasSession(request,env)))return json({error:"Entre novamente no PostFlow3."},401);
 if(!env.POSTFLOW3_MEDIA)return json({error:"O armazenamento de vídeos POSTFLOW3_MEDIA não está configurado."},503);
 try{
  const form=await request.formData(),file=form.get("video");
  if(!(file instanceof File)||!file.size)return json({error:"Selecione um vídeo."},400);
  if(file.size>80*1024*1024)return json({error:"O vídeo precisa ter até 80 MB."},413);
  if(!/^video\/(mp4|quicktime|webm)$/.test(file.type))return json({error:"Para publicar no Instagram, use MP4, MOV ou WebM."},400);
  const videoKey="instagram-media/"+crypto.randomUUID();
  await env.POSTFLOW3_MEDIA.put(videoKey,file.stream(),{httpMetadata:{contentType:file.type}});
  return json({videoKey},201);
 }catch(e){return json({error:String(e?.message||"Não foi possível preparar o vídeo para o Instagram.").slice(0,250)},500);}
}

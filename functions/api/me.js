import { getSession } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 const session=await getSession(request,env);
 if(!session)return json({authenticated:false},200);
 if(!env.POSTFLOW3_DB)return json({authenticated:false,error:"Banco de dados indisponível."},503);
 try{
  const user=await env.POSTFLOW3_DB.prepare("SELECT id,email,display_name,status,plan FROM users WHERE id = ? LIMIT 1").bind(session.userId).first();
  if(!user||user.status!=="active")return json({authenticated:false},200);
  return json({authenticated:true,user:{id:user.id,email:user.email,name:user.display_name,plan:user.plan}},200);
 }catch{return json({error:"Não foi possível verificar a sessão."},500)}
}

import { getSession } from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Cookie"}});
export async function onRequestGet({request,env}){
 const session=await getSession(request,env);
 if(!session)return json({error:"Faça login para continuar."},401);
 if(!env.POSTFLOW3_DB)return json({error:"Banco de dados indisponível."},503);
 try{
  const admin=await env.POSTFLOW3_DB.prepare("SELECT id FROM users WHERE id = ? AND email = 'sergiouai3@gmail.com' COLLATE NOCASE AND status = 'active' LIMIT 1").bind(session.userId).first();
  if(!admin)return json({error:"Acesso restrito à administração."},403);
  const totals=await env.POSTFLOW3_DB.prepare("SELECT COUNT(*) AS total_users, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_users, SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_users, SUM(CASE WHEN plan <> 'free' THEN 1 ELSE 0 END) AS paid_plan_users FROM users WHERE role = 'customer' AND lower(email) <> 'sergiouai3@gmail.com'").first();
  const latest=await env.POSTFLOW3_DB.prepare("SELECT id, display_name AS name, email, status, plan, created_at FROM users WHERE role = 'customer' AND lower(email) <> 'sergiouai3@gmail.com' ORDER BY created_at DESC LIMIT 10").all();
  return json({ok:true,summary:{totalUsers:Number(totals?.total_users||0),activeUsers:Number(totals?.active_users||0),suspendedUsers:Number(totals?.suspended_users||0),paidPlanUsers:Number(totals?.paid_plan_users||0),initialCapacity:10},recentUsers:latest?.results||[]});
 }catch(error){
  console.error("PostFlow3 admin overview failure",error);
  return json({error:"Não foi possível carregar o resumo administrativo."},500);
 }
}

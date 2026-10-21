import { hashPassword, makeSessionCookie, verifyPassword } from "../_lib/security.js";
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}});
const DUMMY="pbkdf2-sha256.210000.AAAAAAAAAAAAAAAAAAAAAA==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
export async function onRequestPost({request,env}){
 if(!env.POSTFLOW3_DB)return json({error:"Banco de dados indisponível."},503);
 let body;try{body=await request.json()}catch{return json({error:"Dados de login inválidos."},400)}
 const email=String(body.email||"").trim().toLowerCase(),password=typeof body.password==="string"?body.password:"";
 if(email.length>254||!email||password.length>128)return json({error:"Informe seu e-mail e senha."},400);
 try{
  const user=await env.POSTFLOW3_DB.prepare("SELECT id,email,password_hash,display_name,status FROM users WHERE email = ? COLLATE NOCASE LIMIT 1").bind(email).first();
  const valid=await verifyPassword(password,user?.password_hash||DUMMY);
  if(!user||!valid||user.status!=="active")return json({error:"E-mail ou senha incorretos."},401);
  return json({ok:true,user:{id:user.id,name:user.display_name,email:user.email}},200,{"Set-Cookie":await makeSessionCookie(env,{id:user.id})});
 }catch{return json({error:"Não foi possível entrar. Tente novamente."},500)}
}
export async function onRequest({request}){return request.method==="POST"?new Response(null,{status:405,headers:{Allow:"POST"}}):json({error:"Método não permitido."},405,{Allow:"POST"});}

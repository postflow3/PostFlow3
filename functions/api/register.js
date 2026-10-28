import { hashPassword, makeSessionCookie } from "../_lib/security.js";
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}});
// Cadastro requer D1 e segredo de sessão configurados no ambiente Pages ativo.
export async function onRequestPost({request,env}){
 if(!env.POSTFLOW3_DB)return json({error:"Banco de dados indisponível. Tente novamente mais tarde."},503);
 if(!env.POSTFLOW3_SESSION_SECRET)return json({error:"O servidor ainda não está pronto para criar contas. Avise o administrador."},503);
 let body;try{body=await request.json()}catch{return json({error:"Envie os dados do cadastro em formato válido."},400)}
 const name=String(body.name||"").trim().replace(/\s+/g," ").slice(0,80);
 const email=String(body.email||"").trim().toLowerCase();
 const password=typeof body.password==="string"?body.password:"";
 if(name.length<2)return json({error:"Informe seu nome (pelo menos 2 caracteres)."},400);
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Informe um e-mail válido."},400);
 if(password.length<10||password.length>128)return json({error:"A senha deve ter entre 10 e 128 caracteres."},400);
 try{
  const existing=await env.POSTFLOW3_DB.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1").bind(email).first();
  if(existing)return json({error:"Já existe uma conta com esse e-mail. Entre ou use outro endereço."},409);
  const id=crypto.randomUUID(),passwordHash=await hashPassword(password);
  try{
   const role=email==="sergiouai3@gmail.com"?"admin":"customer";
   await env.POSTFLOW3_DB.prepare("INSERT INTO users (id,email,password_hash,display_name,role,status,plan) VALUES (?,?,?,?,?,'active','free')").bind(id,email,passwordHash,name,role).run();
  }catch(e){
   const message=String(e?.message||"");
   if(message.includes("USER_CAPACITY_REACHED"))return json({error:"O PostFlow3 atingiu o limite inicial de 10 usuários. Entre em contato com o administrador."},409);
   if(message.toLowerCase().includes("unique"))return json({error:"Já existe uma conta com esse e-mail."},409);
   throw e;
  }
  return json({ok:true,user:{id,name,email},message:"Conta criada. Bem-vindo ao PostFlow3."},201,{"Set-Cookie":await makeSessionCookie(env,{id})});
 }catch(e){console.error("PostFlow3 signup failure",e);return json({error:"Falha interna ao criar a conta.",detail:String(e?.message||e||"erro desconhecido").slice(0,240)},500)}
}
export async function onRequest({request}){return request.method==="POST"?new Response(null,{status:405,headers:{Allow:"POST"}}):json({error:"Método não permitido."},405,{Allow:"POST"});}

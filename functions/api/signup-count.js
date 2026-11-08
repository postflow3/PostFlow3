const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
// Public endpoint returns only an aggregate count; it never exposes customer details.
export async function onRequestGet({env}){
 if(!env.POSTFLOW3_DB)return json({error:"Contagem indisponível."},503);
 try{
  const row=await env.POSTFLOW3_DB.prepare("SELECT COUNT(*) AS total_customers FROM users WHERE role = 'customer' AND lower(email) <> 'sergiouai3@gmail.com'").first();
  return json({totalCustomers:Number(row?.total_customers||0)});
 }catch(error){
  console.error("PostFlow3 public signup counter failure",error);
  return json({error:"Contagem indisponível."},503);
 }
}

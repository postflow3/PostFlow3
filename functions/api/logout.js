const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Set-Cookie":"pf3_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"}});
export async function onRequestPost(){return json({ok:true,message:"Sessão encerrada."});}
export async function onRequest({request}){return request.method==="POST"?new Response(null,{status:405,headers:{Allow:"POST"}}):json({error:"Método não permitido."},405);}

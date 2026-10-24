const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
export async function onRequest(){return new Response(JSON.stringify({error:"O login antigo de administrador foi desativado. Use o cadastro ou login por e-mail do PostFlow3."}),{status:410,headers});}

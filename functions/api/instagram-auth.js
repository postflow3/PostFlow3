import { hasSession, makeStateCookie } from "../_lib/security.js";
export async function onRequestGet({ request, env }) {
 const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
 if(!(await hasSession(request,env))) return new Response(JSON.stringify({error:"Entre no PostFlow3 antes de conectar o Instagram."}),{status:401,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}});
 if(!env.INSTAGRAM_APP_ID||!env.INSTAGRAM_APP_SECRET) return new Response(JSON.stringify({error:"Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET nos secrets do Cloudflare Pages e cadastre /api/instagram-callback como URI de retorno no app da Meta."}),{status:503,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}});
 const redirectUri=env.INSTAGRAM_REDIRECT_URI||new URL("/api/instagram-callback",request.url).toString();
 const state=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join("");
 const params=new URLSearchParams({client_id:env.INSTAGRAM_APP_ID,redirect_uri:redirectUri,response_type:"code",scope:"instagram_business_basic,instagram_business_content_publish",state});
 return new Response(null,{status:302,headers:{...headers,"Location":`https://www.instagram.com/oauth/authorize?${params}`,"Set-Cookie":await makeStateCookie(env,state)}});
}

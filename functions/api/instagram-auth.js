import { getSession, makeOAuthState } from "../_lib/security.js";
export async function onRequestGet({ request, env }) {
 const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
 const session=await getSession(request,env);
 if(!session) return new Response(JSON.stringify({error:"Entre no PostFlow3 antes de conectar o Instagram."}),{status:401,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}});
 if(!env.INSTAGRAM_APP_ID||!env.INSTAGRAM_APP_SECRET) return new Response(JSON.stringify({error:"Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET nos secrets do Cloudflare Pages e cadastre /api/instagram-callback como URI de retorno no app da Meta."}),{status:503,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}});
 const redirectUri=env.INSTAGRAM_REDIRECT_URI||new URL("/api/instagram-callback",request.url).toString();
 const state=await makeOAuthState(env,session.userId);
 const params=new URLSearchParams({force_reauth:"true",client_id:env.INSTAGRAM_APP_ID,redirect_uri:redirectUri,response_type:"code",scope:"instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights",state});
 return new Response(null,{status:302,headers:{...headers,"Location":`https://www.instagram.com/oauth/authorize?${params}`}});
}

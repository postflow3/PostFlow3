import {getSession} from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const session=await getSession(request,env);
 if(!session)return json({error:"Sua sessão expirou. Entre novamente no PostFlow3."},401);
 if(!env.GEMINI_API_KEY)return json({error:"A IA ainda não está configurada. Adicione o secret GEMINI_API_KEY nas variáveis do ambiente Preview do Cloudflare Pages."},503);
 try{
  const input=await request.json();
  const frames=Array.isArray(input.frames)?input.frames.slice(0,4):[];
  const filename=String(input.filename||"vídeo").slice(0,180);
  const context=String(input.context||"").slice(0,1200);
  if(!frames.length)return json({error:"Não consegui analisar imagens do vídeo. Selecione o vídeo novamente e tente outra vez."},400);
  const parts=[{text:"Você é especialista em conteúdo para redes sociais em português do Brasil. Analise os quadros deste vídeo e crie metadados úteis e atraentes, sem prometer viralização nem inventar fatos não visíveis. Gere um título para YouTube com até 90 caracteres, uma legenda natural que funcione no Instagram, hashtags relevantes e específicas (5 a 10, sem acentos quando apropriado), e uma breve justificativa. Evite clickbait enganoso. Retorne APENAS JSON válido com as chaves title, caption, hashtags (array de strings sem # ou com #), rationale. Nome do arquivo: "+filename+". Contexto opcional do criador: "+context}];
  for(const f of frames){
   const match=String(f).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
   if(!match)continue;
   parts.push({inline_data:{mime_type:match[1],data:match[2]}});
  }
  if(parts.length===1)return json({error:"As imagens extraídas do vídeo estão inválidas. Tente outro arquivo."},400);
  const endpoint="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key="+encodeURIComponent(env.GEMINI_API_KEY);
  const payload=JSON.stringify({contents:[{parts}],generationConfig:{temperature:0.7,responseMimeType:"application/json"}});
  let response,data={};
  // O Gemini pode devolver 503 durante picos de demanda. Tente mais uma vez,
  // apenas para erros transitórios, sem repetir erros de chave/permissão.
  for(let attempt=0;attempt<2;attempt++){
   response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:payload});
   data=await response.json().catch(()=>({}));
   if(response.ok||(response.status!==429&&response.status!==503)||attempt===1)break;
   await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(!response.ok){
   const detail=String(data.error?.message||"").slice(0,240);
   const overloaded=response.status===503&&/high demand|overload|unavailable|try again later/i.test(detail);
   const limited=response.status===429;
   return json({error:overloaded?"O Gemini está com muita procura neste momento. Tente novamente em 1 minuto.":limited?"A IA atingiu o limite temporário. Aguarde um pouco e tente novamente.":"A IA não conseguiu analisar o vídeo agora. Verifique a configuração da chave Gemini.",detail},502);
  }
  const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
  let result;try{result=JSON.parse(raw.replace(/^\s*\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60\s*$/,""));}catch{return json({error:"A IA retornou uma resposta que não consegui interpretar. Tente novamente."},502);}
  const hashtags=(Array.isArray(result.hashtags)?result.hashtags:[]).map(x=>String(x).replace(/^#+/,"").replace(/[^\p{L}\p{N}_]/gu,"")).filter(Boolean).slice(0,10);
  return json({title:String(result.title||"").slice(0,100),caption:String(result.caption||"").slice(0,1800),hashtags,rationale:String(result.rationale||"").slice(0,350)});
 }catch{return json({error:"Não foi possível gerar sugestões agora. Tente novamente."},500);}
}

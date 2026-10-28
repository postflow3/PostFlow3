import {getSession} from "../_lib/security.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const session=await getSession(request,env);
 if(!session)return json({error:"Sua sessão expirou. Entre novamente no PostFlow3."},401);
 if(!env.GEMINI_API_KEY)return json({error:"A IA ainda não está configurada. Adicione o secret GEMINI_API_KEY nas variáveis do ambiente Preview do Cloudflare Pages."},503);
 try{
  const contentLength=Number(request.headers.get("content-length")||0);
  if(contentLength>16000000)return json({error:"A solicitação é muito grande. Reduza o tamanho do vídeo ou tente novamente."},413);
  const input=await request.json();
  if(input.action==="hooks"){
   const topic=String(input.topic||"").trim().slice(0,180);
   const goal=String(input.goal||"reter atenção e gerar visualizações").slice(0,100);
   const platform=String(input.platform||"Instagram Reels e YouTube Shorts").slice(0,100);
   const tone=String(input.tone||"natural, direto e curioso").slice(0,100);
   const context=String(input.context||"").slice(0,500);
   if(!topic)return json({error:"Informe o assunto do vídeo."},400);
   const prompt="Você é estrategista de vídeos curtos em português brasileiro. Crie exatamente 10 opções distintas de gancho para os primeiros 1 a 3 segundos de um vídeo sobre: "+topic+". Objetivo: "+goal+". Plataforma: "+platform+". Tom: "+tone+". Contexto e fatos fornecidos: "+(context||"não informado")+". Cada gancho deve ser claro, específico, falável e diferente em ângulo (pergunta, demonstração visual, erro comum, curiosidade, comparação, história, benefício, desafio, surpresa honesta, problema/solução). Não use clickbait enganoso, promessas de viralização, fatos inventados, medo artificial nem alegações de produto não fornecidas. Inclua uma abertura visual realizável, uma CTA natural e uma razão curta para testar o ângulo. Retorne somente JSON válido com chave hooks, array de objetos com hook, angle, visual, cta, rationale. Texto em português brasileiro, pronto para adaptar; evite repetir frases entre opções.";
   const endpoint="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key="+encodeURIComponent(env.GEMINI_API_KEY);
   let response,data={};
   for(let attempt=0;attempt<2;attempt++){response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.9,responseMimeType:"application/json",maxOutputTokens:4500}})});data=await response.json().catch(()=>({}));if(response.ok||(response.status!==429&&response.status!==503)||attempt===1)break;await new Promise(resolve=>setTimeout(resolve,1200));}
   if(!response.ok){const detail=String(data.error?.message||"").slice(0,240);const overloaded=response.status===503&&/high demand|overload|unavailable|try again later/i.test(detail);return json({error:overloaded?"O Gemini está com muita procura. Tente novamente em 1 minuto.":response.status===429?"A IA atingiu o limite temporário. Aguarde um pouco e tente novamente.":"A IA não conseguiu criar os ganchos. Verifique a configuração da chave Gemini.",detail},502);}
   const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
   let generated;try{generated=JSON.parse(raw);}catch{return json({error:"A IA retornou uma resposta que não consegui interpretar. Tente novamente."},502);}
   const hooks=(Array.isArray(generated.hooks)?generated.hooks:[]).slice(0,10).map(x=>({hook:String(x.hook||"").slice(0,350),angle:String(x.angle||"").slice(0,100),visual:String(x.visual||"").slice(0,500),cta:String(x.cta||"").slice(0,250),rationale:String(x.rationale||"").slice(0,350)})).filter(x=>x.hook);
   if(!hooks.length)return json({error:"A IA não gerou ganchos utilizáveis. Tente outro assunto."},502);
   return json({hooks});
  }
  if(input.action==="series"){
   const topic=String(input.topic||"").trim().slice(0,180);
   const style=String(input.style||"realista e natural").slice(0,100);
   const audience=String(input.audience||"").slice(0,180);
   const platforms=String(input.platforms||"Instagram Reels e YouTube Shorts").slice(0,100);
   const duration=String(input.duration||"20 a 30 segundos").slice(0,80);
   const context=String(input.context||"").slice(0,600);
   const count=Math.max(3,Math.min(7,[3,5,7].includes(Number(input.count))?Number(input.count):3));
   if(!topic)return json({error:"Informe o tema para criar a série."},400);
   const prompt="Você é roteirista e especialista em prompts para geradores de vídeo. Crie uma série coerente em português brasileiro sobre: "+topic+". Estilo visual: "+style+". Público: "+(audience||"público geral interessado no tema")+". Plataformas: "+platforms+". Duração de cada episódio: "+duration+". Detalhes extras: "+(context||"não informado")+". Gere exatamente "+count+" episódios conectados, com progressão narrativa e sem repetir o mesmo conteúdo. Cada prompt de vídeo deve ser independente e pronto para copiar em uma ferramenta de geração de vídeo: inclua personagem/objeto, cenário, ação, enquadramento, movimento de câmera, iluminação, estilo, ritmo, som/voz em português brasileiro quando adequado, proporção vertical 9:16, duração solicitada e instruções para não adicionar textos/logos aleatórios. Não diga que o vídeo foi gerado. Retorne somente JSON válido com a chave episodes, array de objetos com number, title, purpose, hook, script (fala/narração e ações visuais com começo/meio/fim), video_prompt, caption (CTA natural), hashtags (4 a 8 strings sem #), continuity (como conecta ao próximo episódio; no último, convide a acompanhar a série). Não invente dados factuais nem prometa viralização.";
   const endpoint="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key="+encodeURIComponent(env.GEMINI_API_KEY);
   let response,data={};
   for(let attempt=0;attempt<2;attempt++){
    response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.8,responseMimeType:"application/json",maxOutputTokens:6000}})});
    data=await response.json().catch(()=>({}));
    if(response.ok||(response.status!==429&&response.status!==503)||attempt===1)break;
    await new Promise(resolve=>setTimeout(resolve,1200));
   }
   if(!response.ok){const detail=String(data.error?.message||"").slice(0,240);const overloaded=response.status===503&&/high demand|overload|unavailable|try again later/i.test(detail);return json({error:overloaded?"O Gemini está com muita procura. Tente novamente em 1 minuto.":response.status===429?"A IA atingiu o limite temporário. Aguarde um pouco e tente novamente.":"A IA não conseguiu criar a série. Verifique a configuração da chave Gemini.",detail},502);}
   const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
   let generated;try{generated=JSON.parse(raw.replace(/^\s*\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60\s*$/,""));}catch{return json({error:"A IA retornou uma série que não consegui interpretar. Tente novamente."},502);}
   const episodes=(Array.isArray(generated.episodes)?generated.episodes:[]).slice(0,count).map((ep,i)=>({number:i+1,title:String(ep.title||("Episódio "+(i+1))).slice(0,180),purpose:String(ep.purpose||"").slice(0,300),hook:String(ep.hook||"").slice(0,300),script:String(ep.script||"").slice(0,1800),video_prompt:String(ep.video_prompt||"").slice(0,3500),caption:String(ep.caption||"").slice(0,800),hashtags:(Array.isArray(ep.hashtags)?ep.hashtags:[]).map(x=>String(x).replace(/^#+/,"").replace(/[^\p{L}\p{N}_]/gu,"")).filter(Boolean).slice(0,8),continuity:String(ep.continuity||"").slice(0,300)})).filter(ep=>ep.title&&ep.video_prompt);
   if(!episodes.length)return json({error:"A IA não gerou episódios com prompts utilizáveis. Tente outro tema."},502);
   return json({episodes});
  }
  if(input.action==="plan"){
   const niche=String(input.niche||"").trim().slice(0,180);
   const audience=String(input.audience||"").trim().slice(0,180);
   const goal=String(input.goal||"crescer audiência").slice(0,100);
   const platforms=String(input.platforms||"Instagram e YouTube Shorts").slice(0,100);
   const frequency=String(input.frequency||"7 ideias, uma por dia").slice(0,100);
   const context=String(input.context||"").slice(0,600);
   if(!niche)return json({error:"Informe seu nicho para gerar um plano personalizado."},400);
   const prompt="Você é estrategista de conteúdo para criadores brasileiros. Crie um plano prático para "+platforms+". Nicho: "+niche+". Público: "+(audience||"público interessado no nicho")+". Objetivo: "+goal+". Frequência solicitada: "+frequency+". Gere exatamente "+(frequency.startsWith("5")?"5":frequency.startsWith("3")?"3":"7")+" ideias. Contexto adicional: "+(context||"não informado")+". Retorne JSON válido com a chave ideas, um array com exatamente a quantidade solicitada de objetos. Cada objeto deve ter day (ex. Dia 1), topic (título claro), hook (gancho inicial curto), format (Reels ou YouTube Shorts), caption (legenda natural de até 500 caracteres com chamada para ação quando adequada), hashtags (array de 4 a 8 strings sem #), best_time (apenas uma sugestão geral, diga para validar com as métricas da conta), rationale (por que a ideia combina com o objetivo). Não prometa viralização, não invente estatísticas ou resultados, não repita ideias e não faça alegações factuais não sustentadas. A resposta deve ser somente JSON.";
   const endpoint="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key="+encodeURIComponent(env.GEMINI_API_KEY);
   let response,data={};
   for(let attempt=0;attempt<2;attempt++){
    response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.75,responseMimeType:"application/json",maxOutputTokens:2600}})});
    data=await response.json().catch(()=>({}));
    if(response.ok||(response.status!==429&&response.status!==503)||attempt===1)break;
    await new Promise(resolve=>setTimeout(resolve,1200));
   }
   if(!response.ok){
    const detail=String(data.error?.message||"").slice(0,240);
    const overloaded=response.status===503&&/high demand|overload|unavailable|try again later/i.test(detail);
    return json({error:overloaded?"O Gemini está com muita procura neste momento. Tente novamente em 1 minuto.":response.status===429?"A IA atingiu o limite temporário. Aguarde um pouco e tente novamente.":"A IA não conseguiu criar o plano. Verifique a configuração da chave Gemini.",detail},502);
   }
   const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
   let plan;try{plan=JSON.parse(raw.replace(/^\s*\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60\s*$/,""));}catch{return json({error:"A IA retornou um plano que não consegui interpretar. Tente novamente."},502);}
   const ideas=(Array.isArray(plan.ideas)?plan.ideas:[]).slice(0,7).map((idea,i)=>({day:String(idea.day||("Dia "+(i+1))).slice(0,40),topic:String(idea.topic||"").slice(0,180),hook:String(idea.hook||"").slice(0,220),format:String(idea.format||"Vídeo curto").slice(0,60),caption:String(idea.caption||"").slice(0,700),hashtags:(Array.isArray(idea.hashtags)?idea.hashtags:[]).map(x=>String(x).replace(/^#+/,"").replace(/[^\p{L}\p{N}_]/gu,"")).filter(Boolean).slice(0,8),best_time:String(idea.best_time||"Valide o horário com as métricas da sua conta.").slice(0,160),rationale:String(idea.rationale||"").slice(0,220)})).filter(idea=>idea.topic);
   if(!ideas.length)return json({error:"A IA não gerou ideias utilizáveis. Tente ajustar o nicho ou o contexto."},502);
   return json({ideas});
  }
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

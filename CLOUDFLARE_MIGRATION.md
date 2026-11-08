# Migração para Cloudflare Pages

O projeto está sendo preparado em uma branch separada. Não publique até que as funções e os secrets estejam configurados e testados.

Domínio planejado: https://postflow3.pages.dev

Secrets necessários no Cloudflare Pages: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, POSTFLOW3_ADMIN_PASSWORD, POSTFLOW3_SESSION_SECRET e TOKEN_ENCRYPTION_KEY. Não coloque valores desses secrets no repositório.

O callback OAuth planejado é https://postflow3.pages.dev/api/youtube-callback. Adicione-o aos URIs autorizados no Google Cloud antes de testar a conexão.


## Estado atual da preparação
- O projeto Cloudflare tem um namespace KV privado chamado `postflow3-private`, vinculado como `POSTFLOW3_KV`.
- `POSTFLOW3_SESSION_SECRET` e `TOKEN_ENCRYPTION_KEY` foram configurados como secrets diretamente na Cloudflare; seus valores não foram exibidos nem colocados no repositório.
- A prévia está autorizada somente para a branch `cloudflare-migration`; o deploy de produção continua desativado.
- Ainda precisam ser cadastrados como secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `POSTFLOW3_ADMIN_PASSWORD` em Preview e Production.

- A prévia da Cloudflare deve acompanhar apenas esta branch de migração enquanto a produção permanece desligada.

## Armazenamento e agendador (revisão de estabilidade)
- D1 (`POSTFLOW3_DB`) é o armazenamento principal para a fila compatível com KV e para tokens sociais do Instagram/YouTube/TikTok; KV pode permanecer temporariamente como fonte legada de leitura.
- O Worker de Cron `postflow3-scheduler` precisa ter o mesmo binding D1 apontando para o mesmo banco usado pelo Pages Preview, além do secret `POSTFLOW3_SCHEDULER_SECRET`. Se o binding D1 não estiver presente no Worker, ele continuará usando o KV legado quando disponível.
- Não remova o namespace KV enquanto houver dados legados que ainda não tenham sido migrados e validados.
- A trava do agendador usa gravação condicional atômica no D1 para evitar duas execuções simultâneas processarem a mesma fila.

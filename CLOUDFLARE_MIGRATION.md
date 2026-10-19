# Migração para Cloudflare Pages

O projeto está sendo preparado em uma branch separada. Não publique até que as funções e os secrets estejam configurados e testados.

Domínio planejado: https://postflow3.pages.dev

Secrets necessários no Cloudflare Pages: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, POSTFLOW3_ADMIN_PASSWORD, POSTFLOW3_SESSION_SECRET e TOKEN_ENCRYPTION_KEY. Não coloque valores desses secrets no repositório.

O callback OAuth planejado é https://postflow3.pages.dev/api/youtube-callback. Adicione-o aos URIs autorizados no Google Cloud antes de testar a conexão.

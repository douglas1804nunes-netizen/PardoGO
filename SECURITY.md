# Security Policy

## Reporte de vulnerabilidade

Reporte falhas de segurança em canal privado. Não abra issue pública com segredos, tokens ou dados sensíveis.

## Requisitos de produção

- Segredos somente por variável de ambiente (Render Dashboard).
- Nunca commitar:
	- `.env`
	- `.env.local`
	- `*.jks`
	- `*.keystore`
	- `android/keystore.properties`
	- `android/local.properties`
- `ADMIN_INITIAL_PASSWORD` obrigatória e forte.
- `ADMIN_INITIAL_PHONE` obrigatória e válida.
- HTTPS obrigatório (`FORCE_HTTPS=1`, `TRUST_PROXY=1`).
- `CORS_ORIGIN` sem wildcard em produção.
- `DB_PATH` nunca em diretório temporário.

## CORS

- Não combinar `Access-Control-Allow-Origin: *` com credenciais.
- Em produção, permitir apenas origens necessárias:
	- `https://pardogo-8yn0.onrender.com`
	- `https://localhost` (Capacitor com `androidScheme=https`)

## PIX

- Webhook exige segredo (`PIX_WEBHOOK_SECRET`).
- Comparação de segredo com timing-safe compare.
- Confirmação duplicada não pode gerar crédito duplicado.

## Sessão e SSE

- Token de sessão não deve ir em query string por padrão.
- SSE usa ticket de curta duração e consumo único.
- No shutdown, conexões SSE e timers são encerrados.

## Operações financeiras

- Débito/crédito de carteira e eventos de corrida são transacionais.
- Fluxos críticos usam `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
- Idempotência de corrida vinculada ao passageiro evita duplicidade por retry.

# Deploy do PardoGo - Etapa 14

## Estratégia oficial

Deploy ativo no Render usa runtime Node com `render.yaml`.

- URL atual de produção: `https://pardogo-8yn0.onrender.com`
- build command: `npm ci --omit=dev`
- start command: `npm run start`
- health check: `/api/health`
- disco persistente: `/var/data`
- banco: `DB_PATH=/var/data/pardogo.sqlite`

O `Dockerfile` permanece como alternativa para outros ambientes, mas nao é a fonte primária do deploy Render atual.

## Variáveis obrigatórias de produção

Defina no Dashboard Render (sem commitar valores):

- `NODE_ENV=production`
- `APP_BASE_URL=https://pardogo-8yn0.onrender.com`
- `CANONICAL_BASE_URL=https://pardogo-8yn0.onrender.com`
- `DB_PATH=/var/data/pardogo.sqlite`
- `FORCE_HTTPS=1`
- `TRUST_PROXY=1`
- `REQUIRE_SECURE_ENV=1`
- `ADMIN_INITIAL_PHONE` (real, válido)
- `ADMIN_INITIAL_PASSWORD` (forte, sem placeholder)
- `CORS_ORIGIN=https://pardogo-8yn0.onrender.com,https://localhost`

Para PIX webhook:

- `PIX_WEBHOOK_SECRET` (obrigatório se webhook habilitado)

## Regras de segurança de deploy

- Nunca usar `CORS_ORIGIN=*` em produção.
- Nunca usar `DB_PATH` em diretório temporário (`/tmp`, `temp`).
- Nunca publicar senha padrão de admin em documentação.
- Não fixar `PORT` em produção: usar `process.env.PORT`.

## Passo a passo de validação pós-deploy

```bash
node --check server.js
npm test
npm run doctor
npm run mobile:check
```

Validações manuais mínimas:

1. `GET /api/health` com `ok=true` e status 200.
2. Cadastro/login passageiro.
3. Cadastro/aprovação/login motorista.
4. Corrida: criar -> aceitar -> finalizar.
5. Corrida com Saldo do app + cancelamento com estorno.
6. SSE funcionando para passageiro e motorista.
7. CORS aceitando apenas origens permitidas.

## Android em produção

`public/mobile-config.js` deve manter:

- `apiBaseUrl: 'https://pardogo-8yn0.onrender.com'`
- `appStage: 'production'`
- `enableApiSetupScreen: false`

Depois de alterar frontend/config:

```bash
npx cap sync android
```

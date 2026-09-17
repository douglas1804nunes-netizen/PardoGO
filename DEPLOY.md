# Deploy do PardoGo - Etapa 14

## Estratégia oficial

Deploy ativo no Render usa runtime Node com `render.yaml`.

- URL atual de produção: `https://pardogo-8yn0.onrender.com`
- build command: `npm ci --omit=dev`
- start command: `npm run start`
- health check: `/api/health`
- banco: Postgres gerenciado pelo Supabase, via `DATABASE_URL`

## Banco de dados (Supabase)

1. Crie (ou reutilize) o projeto no [supabase.com](https://supabase.com).
2. Em *Project Settings > Database > Connection pooling*, copie a connection string do **Session pooler** (compatível com redes IPv4, como o Render) — formato `postgresql://postgres.<ref>:<senha>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. Cole o valor em `DATABASE_URL` no Dashboard do Render (variável `sync: false`, nunca commitada).
4. O schema (tabelas/índices) e o usuário admin são criados automaticamente no boot do servidor (`migrate()`/`seed()` em `server.js`).

## Variáveis obrigatórias de produção

Defina no Dashboard Render (sem commitar valores):

- `NODE_ENV=production`
- `APP_BASE_URL=https://pardogo-8yn0.onrender.com`
- `CANONICAL_BASE_URL=https://pardogo-8yn0.onrender.com`
- `DATABASE_URL` (connection string do Postgres no Supabase)
- `FORCE_HTTPS=1`
- `TRUST_PROXY=1`
- `REQUIRE_SECURE_ENV=1`
- `ADMIN_INITIAL_PHONE` (real, válido)
- `ADMIN_INITIAL_PASSWORD` (forte, sem placeholder)
- `CORS_ORIGIN=https://pardogo-8yn0.onrender.com,https://localhost`

## Regras de segurança de deploy

- Nunca usar `CORS_ORIGIN=*` em produção.
- Nunca commitar `DATABASE_URL` nem qualquer connection string com senha.
- Nunca publicar senha padrão de admin em documentação.
- Não fixar `PORT` em produção: usar `process.env.PORT`.

## Passo a passo de validação pós-deploy

```bash
node --check backend/server.js
npm test
npm run doctor
npm run mobile:check
```

Validações manuais mínimas:

1. `GET /api/health` com `ok=true` e status 200.
2. Cadastro/login passageiro.
3. Cadastro/aprovação/login motorista.
4. Corrida: criar -> aceitar -> finalizar.
5. SSE funcionando para passageiro e motorista.
6. CORS aceitando apenas origens permitidas.

## Android em produção

`frontend/mobile-config.js` deve manter:

- `apiBaseUrl: 'https://pardogo-8yn0.onrender.com'`
- `appStage: 'production'`
- `enableApiSetupScreen: false`

Depois de alterar frontend/config:

```bash
npx cap sync android
```

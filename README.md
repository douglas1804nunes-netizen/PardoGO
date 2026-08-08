# PardoGo - Etapa 14

Plataforma de mobilidade local com frontend web/Capacitor, backend Node.js e SQLite persistente no servidor.

Arquitetura de producao:

Android Capacitor / PWA -> API HTTPS -> Node.js -> SQLite em disco persistente Render (`/var/data/pardogo.sqlite`).

## Stack

- Node.js 22 LTS (`>=22.13.0 <25`)
- `node:sqlite`
- SQLite
- SSE/EventSource
- Capacitor 7 + Android
- Leaflet/OpenStreetMap

## Requisitos

- Node compatível com `engines` e `.node-version`
- npm

## Configuração de ambiente

1. Copie `.env.example` para `.env`.
2. Defina credenciais administrativas pelas variáveis:
   - `ADMIN_INITIAL_PHONE`
   - `ADMIN_INITIAL_PASSWORD`

Importante:

- Nao existe credencial administrativa publica padrao para produção.
- Nao use `CORS_ORIGIN=*` em produção.
- Em produção, use `DB_PATH=/var/data/pardogo.sqlite`.

## Execução local

```bash
npm ci
npm run start
```

URL local:

```text
http://localhost:5173
```

## Testes e diagnósticos

```bash
node --check server.js
npm test
npm run doctor
npm run mobile:check
node --no-warnings scripts/security-regression-test.js
node --no-warnings scripts/cors-regression-test.js
```

## Android / Capacitor

Sincronizar projeto Android:

```bash
npx cap sync android
```

Build debug no Windows:

```bash
cd android
gradlew.bat assembleDebug
```

Configuracao de produção mobile (`public/mobile-config.js`):

- `apiBaseUrl: 'https://pardogo-8yn0.onrender.com'`
- `appStage: 'production'`
- `enableApiSetupScreen: false`

## Deploy Render

Deploy principal usa `render.yaml` com runtime Node (nao Docker):

- build deterministico: `npm ci --omit=dev`
- health check: `/api/health`
- disco persistente em `/var/data`
- `DB_PATH=/var/data/pardogo.sqlite`

Detalhes em `DEPLOY.md`.

## Segurança

- Segredos apenas em variáveis de ambiente.
- Nunca commitar `.env`, `.jks`, `.keystore`, `android/keystore.properties`.
- CORS restrito por ambiente.
- Shutdown gracioso com fechamento de SSE e SQLite.

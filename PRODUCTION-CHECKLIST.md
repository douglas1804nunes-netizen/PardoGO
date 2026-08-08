# Checklist de produção

## Ambiente e segurança

- [ ] `.env` não rastreado no Git
- [ ] keystore e credenciais fora do Git
- [ ] `NODE_ENV=production`
- [ ] `FORCE_HTTPS=1`
- [ ] `TRUST_PROXY=1`
- [ ] `REQUIRE_SECURE_ENV=1`
- [ ] `ADMIN_INITIAL_PHONE` válido
- [ ] `ADMIN_INITIAL_PASSWORD` forte (sem placeholder)

## Banco e persistência

- [ ] `DB_PATH=/var/data/pardogo.sqlite`
- [ ] disco persistente Render ativo
- [ ] backup executado e restaurável
- [ ] migrations retrocompatíveis aplicadas sem perda de dados

## CORS e rede

- [ ] produção sem `CORS_ORIGIN=*`
- [ ] origens permitidas revisadas (`https://pardogo-8yn0.onrender.com`, `https://localhost`)
- [ ] preflight OPTIONS validado

## Runtime e build

- [ ] Node na faixa `>=22.13.0 <25`
- [ ] `npm ci --omit=dev` no deploy
- [ ] `node --check server.js` OK
- [ ] `/api/health` com probe SQLite real

## Wallet / rides / PIX

- [ ] criação de corrida com idempotência validada
- [ ] retry não cria corrida duplicada
- [ ] pagamento com Saldo do app atômico
- [ ] cancelamento com estorno atômico
- [ ] confirmação PIX duplicada não duplica crédito

## SSE / sessão

- [ ] ticket SSE expira e é de uso único
- [ ] reconexão não duplica listeners
- [ ] logout revoga sessão
- [ ] graceful shutdown encerra SSE e SQLite

## Mobile / Android

- [ ] `appId` permanece `br.com.pardogo.app`
- [ ] `androidScheme=https` e `cleartext=false`
- [ ] `public/mobile-config.js` com API produção HTTPS
- [ ] `enableApiSetupScreen=false` para release
- [ ] `npx cap sync android` executado
- [ ] `gradlew.bat assembleDebug` OK

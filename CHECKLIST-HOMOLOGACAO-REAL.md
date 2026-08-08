# Checklist de Homologacao Real - PardoGo

Este documento é um roteiro de execução. Marque apenas após validar no ambiente alvo.

## 1. Preparação

- [ ] Confirmar API de produção: `https://pardogo-8yn0.onrender.com`
- [ ] Confirmar `CORS_ORIGIN` sem wildcard
- [ ] Confirmar `DB_PATH=/var/data/pardogo.sqlite`
- [ ] Confirmar credenciais admin definidas por variáveis de ambiente

## 2. Build e diagnóstico

- [ ] `node --check server.js`
- [ ] `npm test`
- [ ] `npm run doctor`
- [ ] `npm run mobile:check`
- [ ] `npx cap sync android`
- [ ] `cd android && gradlew.bat assembleDebug`

## 3. Fluxos funcionais obrigatórios

- [ ] Health endpoint responde 200 com `ok=true`
- [ ] Cadastro de passageiro
- [ ] Cadastro de motorista
- [ ] Aprovação de motorista (admin)
- [ ] Login passageiro/motorista/admin
- [ ] Motorista online
- [ ] Criação de corrida
- [ ] Aceite da corrida
- [ ] Concorrência: dois motoristas tentando aceitar
- [ ] Finalização da corrida
- [ ] Cancelamento da corrida
- [ ] Pagamento Dinheiro
- [ ] Pagamento PIX
- [ ] Pagamento Saldo do app
- [ ] Saldo insuficiente bloqueia corrida
- [ ] Retry com mesma idempotencyKey não duplica corrida
- [ ] Estorno de corrida cancelada
- [ ] SSE (criação/aceite/finalização/cancelamento)
- [ ] Logout e login novamente
- [ ] CORS e preflight
- [ ] Rate limit e autenticação
- [ ] Geolocalização no app

## 4. APK/AAB

- [ ] Verificar que `android/app/src/main/assets/public/mobile-config.js` aponta para produção HTTPS
- [ ] Verificar `enableApiSetupScreen=false` em build release
- [ ] Se gerar release, calcular novo SHA256 do artefato atual (não reutilizar hash antigo)

## 5. Critérios de aceite

- [ ] Sem inconsistência financeira (débito/estorno/ledger)
- [ ] Sem duplicidade de corrida por retry/concorrência
- [ ] Sem segredos expostos em logs, docs ou Git
- [ ] Sem regressão crítica de fluxo passageiro/motorista/admin

# Checklist de Homologacao Real - PardoGo

## 1. Prontidao tecnica (ja validada)
- API local respondendo: `http://localhost:5173/api/health`
- API producao Render respondendo: `https://pardogo-8yn0.onrender.com/api/health`
- Testes automatizados: `npm run test`
- Diagnostico estrutural: `npm run doctor`
- Diagnostico mobile: `npm run mobile:check`
- Build Android release: `android/app/build/outputs/apk/release/app-release.apk`
- SHA256 do APK release: `788A2CD82DA55A47F795DE1F9CC7F90E489F1B741786A92ED66A965F2DE986CA`

## 2. Usuarios cadastrados (local)
- Admin: ativo
- Motorista: aprovado
- Passageiros: ativos

Observacao: se for validar em producao, os usuarios da base local e da base Render podem ser diferentes.

## 3. Instalar APK em outros celulares
1. Copiar `android/app/build/outputs/apk/release/app-release.apk` para o celular.
2. Conferir o hash SHA256 no computador antes de enviar (integridade).
3. No Android, permitir instalacao de fontes desconhecidas para o app usado no envio.
4. Instalar e abrir o app.
5. Confirmar que o app aponta para producao em `public/mobile-config.js`.

## 4. Roteiro de homologacao com usuarios reais
1. Login de passageiro com conta ativa.
2. Login de motorista com conta aprovada.
3. Passageiro solicita corrida (origem + destino + estimativa).
4. Motorista visualiza e aceita corrida.
5. Passageiro e motorista acompanham status em tempo real.
6. Finalizar corrida.
7. Validar historico da corrida em Passageiro, Motorista e Admin.
8. Validar pagamento (Pix, Dinheiro e Saldo do app quando aplicavel).
9. Abrir chamado de suporte e enviar denuncia para testar trilha de seguranca.
10. Validar estabilidade apos logout/login novamente.

## 5. Critérios de aceite
- Nao pode haver erro de login/cadastro para contas ativas.
- Corrida deve percorrer: solicitada -> aceita -> finalizada sem inconsistencias.
- Painel Admin deve refletir usuarios e corridas corretamente.
- App nao pode travar ao alternar entre telas e mapa.
- API de producao deve permanecer com health 200 durante o teste.

## 6. Comandos uteis
- `npm run test`
- `npm run doctor`
- `npm run mobile:check`
- `npm run cap:sync:android`
- Build release manual: `cd android && gradlew.bat assembleRelease`

# PardoGo - Etapa 14

Sistema de transporte local para Santa Rita do Pardo-MS, agora com preparação para virar aplicativo Android usando Capacitor.

## O que existe até aqui

- Backend Node.js com SQLite.
- Login com sessão/token.
- Passageiro, motorista e administrador.
- Cadastro com aceite de termos e privacidade.
- Aprovação, bloqueio e revisão documental de motorista.
- Pedido, aceite, finalização e cancelamento de corrida.
- Mapa com Leaflet/OpenStreetMap.
- Cálculo de rota, distância, tempo e tarifa.
- Tempo real com SSE/EventSource.
- WhatsApp/ligação entre passageiro e motorista.
- Avaliação de corrida.
- Suporte, denúncias e painel admin.
- CSS moderno com azul/ciano, dark mode urbano e contrastes vibrantes.
- Deploy online com Docker/Render/VPS.
- Etapa 14: preparação Android com Capacitor e API online configurável.

## Rodar localmente

```bash
npm run start
```

Abra:

```text
http://localhost:5173
```

Login inicial:

```text
Telefone: admin
Senha: 123456
```

## Testes

```bash
npm run test
npm run mobile:check
```

## Configurar o app Android

O app Android precisa conversar com uma API online em HTTPS. Existem duas formas:

1. Pela tela **App**, informe a URL da API.
2. Antes de gerar o app, edite `public/mobile-config.js`:

```js
window.PARDOGO_MOBILE_CONFIG = {
  apiBaseUrl: 'https://api.seudominio.com',
  appStage: 'production',
  enableApiSetupScreen: true,
  googleClientId: ''
};
```

Para ativar cadastro/login com Google:

1. Preencha `GOOGLE_CLIENT_ID` no arquivo `.env` (ou variável de ambiente no servidor).
2. Preencha o mesmo valor em `public/mobile-config.js` no campo `googleClientId`.
3. Rode `npm run cap:sync:android` para atualizar o app Android.

Para teste local no navegador, deixe `apiBaseUrl` vazio.

Perfil automático por ambiente (sem depender de IP local em produção):

```js
window.PARDOGO_MOBILE_CONFIG = {
  appStage: 'production',
  autoSelectProfile: true,
  profiles: {
    development: 'http://192.168.1.7:5173',
    production: 'https://api.seudominio.com'
  }
};
```

Com `autoSelectProfile: true`, o app usa a URL do perfil definido em `appStage`.
Para build de produção, troque `appStage` para `production` e configure sua API HTTPS real em `profiles.production`.

## Assinatura Android de produção

Para gerar APK de produção assinado com seu certificado:

1. Crie uma cópia de `android/keystore.properties.example` com o nome `android/keystore.properties`.
2. Preencha o caminho do seu `.jks` e as credenciais da chave.
3. Rode o build release no Android:

```bash
cd android
./gradlew assembleRelease
```

Saída esperada:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Se `android/keystore.properties` não existir, o build release continua possível, mas sai sem assinatura de produção.

## Gerar projeto Android

Instale dependências:

```bash
npm install
```

Gere a pasta Android:

```bash
npm run cap:add:android
```

Sincronize arquivos web:

```bash
npm run cap:sync:android
```

Gerar build Android debug (com deteccao automatica de JAVA_HOME):

```bash
npm run android:build:debug
```

Abra no Android Studio:

```bash
npm run cap:open:android
```

Depois use o Android Studio para rodar em emulador ou celular físico.

## Arquivos importantes da Etapa 14

- `capacitor.config.json`: configuração do app.
- `public/mobile-config.js`: URL da API para o app.
- `mobile/android-permissions.md`: permissões recomendadas.
- `APP.md`: guia detalhado do Android.
- `DEPLOY.md`: guia para colocar o backend online.
- `scripts/mobile-check.js`: checklist mobile.

## Observação

O app Android não deve usar banco SQLite dentro do celular. Ele deve consumir o backend online. O SQLite continua no servidor enquanto o projeto ainda está em MVP.

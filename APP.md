# App Android - PardoGo Etapa 14

## Arquitetura mobile

O app Android usa Capacitor 7 com frontend da pasta `public`.

Fluxo:

App Android -> API HTTPS -> backend Node.js -> SQLite persistente no Render.

## Configuração usada em produção

Em `public/mobile-config.js`:

- `apiBaseUrl: 'https://pardogo-8yn0.onrender.com'`
- `appStage: 'production'`
- `enableApiSetupScreen: false`

Isso evita que build release use endpoint local ou permita troca manual de backend por usuário final.

## Geolocalização

Implementação atual usa `navigator.geolocation` (Web API).

- `capacitor.config.json` mantém `androidScheme: "https"`.
- Android Manifest já inclui:
  - `INTERNET`
  - `ACCESS_COARSE_LOCATION`
  - `ACCESS_FINE_LOCATION`
  - `ACCESS_NETWORK_STATE`

Plugin nativo `@capacitor/geolocation` nao é usado no código atual.

## Comandos principais

```bash
npm ci
npx cap --version
npx cap doctor
npm run mobile:check
npx cap sync android
```

Build debug no Windows:

```bash
cd android
gradlew.bat assembleDebug
```

## Verificação de sync

Após `npx cap sync android`, confirme o arquivo copiado:

- `android/app/src/main/assets/public/mobile-config.js`

Deve manter `apiBaseUrl` de produção HTTPS e `enableApiSetupScreen: false`.

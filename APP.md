# App Android - PardoGo Etapa 14

A Etapa 14 prepara o PardoGo para virar aplicativo Android usando Capacitor.

## Decisão técnica

O app Android será uma casca nativa que abre o front-end da pasta `public`. Os dados continuam no backend Node.js com SQLite, preferencialmente publicado online com HTTPS.

Fluxo recomendado:

```text
App Android -> API online HTTPS -> Backend Node.js -> SQLite no servidor
```

Não use o banco local do celular para a operação principal, porque passageiro, motorista e admin precisam compartilhar os mesmos dados em tempo real.

## 1. Coloque o backend online

Antes do app real, publique o backend com HTTPS. Consulte `DEPLOY.md`.

Exemplo de API:

```text
https://api.pardogo.com.br
```

## 2. Configure a URL da API no app

Edite `public/mobile-config.js`:

```js
window.PARDOGO_MOBILE_CONFIG = {
  apiBaseUrl: 'https://api.seudominio.com',
  appStage: 'production',
  enableApiSetupScreen: true
};
```

Durante teste local, pode deixar vazio:

```js
apiBaseUrl: ''
```

## 3. Instale dependências

```bash
npm install
```

## 4. Faça o checklist mobile

```bash
npm run mobile:check
```

## 5. Gere o Android

```bash
npm run cap:add:android
```

Se a pasta `android` já existir em uma continuação futura, use apenas:

```bash
npm run cap:sync:android
```

## 6. Abra no Android Studio

```bash
npm run cap:open:android
```

No Android Studio:

1. Espere o Gradle carregar.
2. Escolha um emulador ou celular físico.
3. Clique em Run.
4. Teste login, mapa, localização e tempo real.

## 7. Permissões Android

Confira `mobile/android-permissions.md`.

Permissões esperadas:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

## 8. Pontos críticos para testar

- Login do admin.
- Cadastro do passageiro.
- Cadastro do motorista.
- Aprovação de motorista pelo admin.
- Motorista online.
- Passageiro pedindo corrida.
- Motorista recebendo corrida em tempo real.
- Geolocalização no celular.
- Mapa carregando com internet móvel.
- Botões de WhatsApp e ligação.
- Cancelamento e avaliação.

## 9. Próxima etapa sugerida

Etapa 15: preparar publicação Android, com ícones finais, splash screen, nome comercial, assinatura do APK/AAB e checklist Google Play.

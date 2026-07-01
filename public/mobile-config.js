// Configuração opcional para o app Android/iOS.
// Para app publicado, preencha a URL do backend online antes de rodar `npm run cap:sync:android`.
window.PARDOGO_MOBILE_CONFIG = {
  apiBaseUrl: 'http://192.168.1.7:5173',
  appStage: 'development',
  enableApiSetupScreen: true,
  googleClientId: '',
  autoSelectProfile: true,
  profiles: {
    development: 'http://192.168.1.7:5173',
    production: 'https://api.seudominio.com'
  }
};


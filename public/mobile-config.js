// Configuração opcional para o app Android/iOS.
// Para app publicado, preencha a URL do backend online antes de rodar `npm run cap:sync:android`.
window.PARDOGO_MOBILE_CONFIG = {
  apiBaseUrl: 'https://pardogo-8yn0.onrender.com',
  appStage: 'production',
  enableApiSetupScreen: false,
  adminOnlyApk: false,
  adminWebOnly: true,
  googleClientId: '',
  autoSelectProfile: true,
  profiles: {
    development: 'http://192.168.1.7:5173',
    production: 'https://pardogo-8yn0.onrender.com'
  }
};


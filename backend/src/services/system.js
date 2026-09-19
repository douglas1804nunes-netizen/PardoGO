const { validateEnvConfig } = require('../config/env');
const { envConfig, APP_VERSION, NODE_ENV, PORT, APP_BASE_URL, SESSION_DAYS, ADMIN_INITIAL_PASSWORD, FORCE_HTTPS, TRUST_PROXY, REQUIRE_SECURE_ENV, CORS_ALLOW_ALL, CORS_ALLOWED_ORIGINS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES } = require('../config');

function validateProductionConfig() {
  const warnings = [];
  try {
    validateEnvConfig(envConfig);
  } catch (error) {
    if (NODE_ENV === 'production' && REQUIRE_SECURE_ENV) {
      throw error;
    }
    warnings.push(error.message);
  }
  if (NODE_ENV === 'production' && ADMIN_INITIAL_PASSWORD === '123456') {
    warnings.push('Troque ADMIN_INITIAL_PASSWORD antes de operar em produção.');
  }
  if (NODE_ENV === 'production' && !String(APP_BASE_URL).startsWith('https://')) {
    warnings.push('APP_BASE_URL precisa usar HTTPS em produção.');
  }
  if (NODE_ENV === 'production' && !FORCE_HTTPS) {
    warnings.push('Ative FORCE_HTTPS=1 quando estiver atrás de proxy com HTTPS.');
  }
  if (NODE_ENV === 'production' && CORS_ALLOW_ALL) {
    warnings.push('Evite CORS_ORIGIN=* em produção. Defina origem explícita do app/web.');
  }
  if (NODE_ENV === 'production') {
    const badOrigins = CORS_ALLOWED_ORIGINS.filter(origin => origin.startsWith('http://'));
    if (badOrigins.length) warnings.push(`Remova origens HTTP em produção: ${badOrigins.join(', ')}`);
  }
  if (warnings.length && REQUIRE_SECURE_ENV) {
    throw new Error(`Configuração insegura para produção: ${warnings.join(' ')}`);
  }
  return warnings;
}

function systemChecklist() {
  const warnings = validateProductionConfig();
  return {
    app: 'PardoGo',
    version: APP_VERSION,
    environment: NODE_ENV,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    baseUrl: APP_BASE_URL,
    port: PORT,
    database: {
      type: 'PostgreSQL',
      provider: 'Supabase'
    },
    security: {
      forceHttps: FORCE_HTTPS,
      trustProxy: TRUST_PROXY,
      sessionDays: SESSION_DAYS,
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      rateLimitMax: RATE_LIMIT_MAX,
      secureAdminPasswordConfigured: ADMIN_INITIAL_PASSWORD !== '123456',
      loginMaxAttempts: LOGIN_MAX_ATTEMPTS,
      loginLockMinutes: LOGIN_LOCK_MINUTES,
      corsAllowAll: CORS_ALLOW_ALL
    },
    productionWarnings: warnings,
    checklist: [
      'Configurar domínio apontando para o servidor.',
      'Ativar HTTPS no proxy/host.',
      'Trocar ADMIN_INITIAL_PASSWORD no primeiro deploy.',
      'Configurar backups automáticos do banco no painel do Supabase.',
      'Testar cadastro, corrida, tempo real e mapa no domínio final.',
      'Revisar termos, privacidade e regras municipais antes da operação real.',
      'Configurar CORS_ORIGIN para permitir o app Android/Capacitor acessar a API.',
      'Definir a URL do backend online em frontend/mobile-config.js antes do build Android.'
    ]
  };
}

module.exports = {
  validateProductionConfig,
  systemChecklist
};

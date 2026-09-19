const { PORT, NODE_ENV, APP_BASE_URL } = require('./src/config');
const { createServer, installGracefulShutdown } = require('./src/app');
const { closeDatabaseSafely } = require('./src/db/connection');
const { validateProductionConfig } = require('./src/services/system');

if (require.main === module) {
  (async () => {
    const server = await createServer();
    installGracefulShutdown(server);
    server.listen(PORT, () => {
      console.log(`PardoGo Etapa 14 rodando em http://localhost:${PORT}`);
      console.log(`Ambiente: ${NODE_ENV} | Base URL: ${APP_BASE_URL}`);
      console.log('Banco: PostgreSQL (Supabase)');
      const warnings = validateProductionConfig();
      warnings.forEach(warning => console.warn(`Aviso de produção: ${warning}`));
    });
  })().catch(error => {
    console.error(`Falha ao iniciar o servidor: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { createServer, closeDatabaseSafely };

# Deploy do PardoGo - Etapa 14

Esta etapa prepara o projeto para sair do computador e ir para um endereço online com domínio e HTTPS.

## 1. Antes de publicar

Checklist obrigatório:

- Trocar a senha inicial do admin.
- Usar HTTPS.
- Definir domínio.
- Fazer backup do banco antes e depois dos testes.
- Testar cadastro, login, corrida, mapa, tempo real e painel admin.
- Revisar termos de uso, política de privacidade e regras municipais para transporte privado.

## 2. Variáveis de ambiente

Copie o arquivo `.env.example` e configure conforme o servidor:

```bash
cp .env.example .env
```

Principais variáveis:

```text
NODE_ENV=production
PORT=5173
APP_BASE_URL=https://seudominio.com.br
DB_PATH=./data/pardogo.sqlite
ADMIN_INITIAL_PHONE=admin
ADMIN_INITIAL_PASSWORD=troque-essa-senha-forte
FORCE_HTTPS=1
TRUST_PROXY=1
```

## 3. Opção simples: Render/Railway/Fly

Use plataformas que suportem Node.js rodando continuamente. O projeto tem:

- `package.json` com `npm run start`.
- `render.yaml` como exemplo.
- `Dockerfile` para plataformas que aceitam container.
- `/api/health` para health check.

Atenção: SQLite precisa de armazenamento persistente. Em serviços que apagam disco no redeploy, use volume persistente ou migre futuramente para PostgreSQL/Supabase.

## 4. Opção profissional: VPS com Nginx + SSL

Fluxo recomendado:

1. Comprar VPS Linux.
2. Instalar Node.js 22+.
3. Enviar a pasta do projeto para `/var/www/pardogo`.
4. Criar `.env` baseado no `.env.example`.
5. Rodar:

```bash
npm install --omit=dev
npm run doctor
npm run start
```

6. Configurar serviço systemd usando `deploy/systemd.service.example`.
7. Configurar Nginx usando `deploy/nginx.conf.example`.
8. Gerar SSL com Certbot/Let's Encrypt.

## 5. Backup

Backup manual:

```bash
npm run backup
```

Recomendação para operação real: agendar backup diário do arquivo SQLite e salvar fora do servidor.

## 6. Domínio

No provedor do domínio, crie um apontamento DNS:

```text
Tipo: A
Nome: @
Valor: IP_DO_SERVIDOR
```

Para subdomínio:

```text
Tipo: A
Nome: app
Valor: IP_DO_SERVIDOR
```

Depois o app ficaria, por exemplo:

```text
https://app.seudominio.com.br
```

## 7. Observação importante

Esta etapa deixa o projeto pronto para pré-produção. Para operação real com muitos usuários, a próxima evolução recomendada é migrar o banco SQLite para PostgreSQL/Supabase, adicionar upload real de documentos e criar notificações push.

## Observação para Etapa 14 - App Android

Depois de publicar o backend online, configure CORS e a URL da API para o app.

No servidor, em `.env`:

```env
CORS_ORIGIN=*
APP_BASE_URL=https://api.seudominio.com
```

No app, em `public/mobile-config.js`:

```js
window.PARDOGO_MOBILE_CONFIG = {
  apiBaseUrl: 'https://api.seudominio.com',
  appStage: 'production',
  enableApiSetupScreen: true
};
```

Depois rode:

```bash
npm run cap:sync:android
npm run cap:open:android
```

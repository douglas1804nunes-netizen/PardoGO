# Arquitetura PardoGo

## Visão geral

Android Capacitor / PWA -> API HTTPS -> backend Node.js -> Postgres (Supabase).

## Componentes

1. Frontend (`frontend/`)
- Interface de passageiro, motorista e administrador.
- Integração com geolocalização (`navigator.geolocation`).
- SSE via `EventSource` para atualizações em tempo real.
- Configuração mobile em `frontend/mobile-config.js`.

2. Backend (`backend/server.js` + `backend/src/`)
- `backend/server.js` é só o ponto de entrada (sobe o servidor e reexporta `createServer` e afins para os scripts de teste).
- Organização em módulos (as dependências só apontam "para baixo", sem ciclos):

```text
backend/src/
  config/      env.js (leitura/validação do .env) e index.js (constantes derivadas)
  utils/       validation.js (telefone, e-mail, senha, datas, campos obrigatórios)
  db/          pg.js (pool), schema.js (migrate), seed.js, connection.js (abrir/fechar)
  services/    regras de negócio: users, sessions, password, rides, ratings, tariff,
               geo, realtime (SSE), support, legal, audit, admin, system
  http/        security (CORS, rate limit, redirects), response, auth, static, router
  routes/      um arquivo por área: system, events, auth, maps, rides, driver, support, admin
  app.js       createServer e shutdown gracioso
```

- Cada arquivo de `routes/` exporta `handle(req, res, url)` e devolve `NOT_HANDLED` quando a requisição não é dele; `http/router.js` tenta um por um e responde 404 no fim.
- Para criar uma rota nova: adicione o bloco `if (method === ... && pathname === ...)` no arquivo da área (ou crie um arquivo em `routes/` e registre em `http/router.js`).
- API REST com autenticação por sessão/token.
- Controle de CORS por ambiente.
- Máquina de estados de corrida:
	- `pending -> accepted`
	- `pending -> cancelled`
	- `accepted -> finished`
	- `accepted -> cancelled`
- SSE com ticket de curta duração, consumo único e ping periódico.
- Shutdown gracioso em `SIGTERM`/`SIGINT`.

3. Configuração (`backend/src/config/env.js`)
- Leitura segura de `.env`.
- Validação rígida de produção:
	- admin obrigatório e forte
	- URL HTTPS
	- CORS sem wildcard
	- `DATABASE_URL` válida (Postgres)

4. Persistência Postgres (`backend/src/db/pg.js`)
- Banco principal configurável por `DATABASE_URL` (Supabase).
- Pool de conexões via `pg`.
- Schema criado/atualizado automaticamente no boot (`migrate()`/`seed()`).

## Pagamento / Corridas

- Formas de pagamento suportadas: `Pix` e `Dinheiro`.
- A plataforma não mantém carteira interna nem recarga PIX com confirmação administrativa.
- Idempotência real de corrida por `idempotencyKey` vinculada a `passenger_id` com índice `UNIQUE`.

## Render

- Fonte principal de deploy: `Dockerfile` (serviço Render configurado como Docker).
- Build determinístico: `npm ci --omit=dev` dentro da imagem.
- Health endpoint real: `/api/health` com probe Postgres.

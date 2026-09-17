# Arquitetura PardoGo

## Visão geral

Android Capacitor / PWA -> API HTTPS -> backend Node.js -> Postgres (Supabase).

## Componentes

1. Frontend (`frontend/`)
- Interface de passageiro, motorista e administrador.
- Integração com geolocalização (`navigator.geolocation`).
- SSE via `EventSource` para atualizações em tempo real.
- Configuração mobile em `frontend/mobile-config.js`.

2. Backend (`backend/server.js`)
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
- Pool de conexões via `pg`, com `AsyncLocalStorage` para transações.
- Schema criado/atualizado automaticamente no boot (`migrate()`/`seed()`).

## Pagamento / Corridas

- Formas de pagamento suportadas: `Pix` e `Dinheiro`.
- A plataforma não mantém carteira interna nem recarga PIX com confirmação administrativa.
- Idempotência real de corrida por `idempotencyKey` vinculada a `passenger_id` com índice `UNIQUE`.

## Render

- Fonte principal de deploy: `render.yaml` + `package.json`.
- Build determinístico: `npm ci --omit=dev`.
- Health endpoint real: `/api/health` com probe Postgres.

# Arquitetura PardoGo

## Visão geral

Android Capacitor / PWA -> API HTTPS -> backend Node.js -> SQLite persistente no Render.

## Componentes

1. Frontend (`public`)
- Interface de passageiro, motorista e administrador.
- Integração com geolocalização (`navigator.geolocation`).
- SSE via `EventSource` para atualizações em tempo real.
- Configuração mobile em `public/mobile-config.js`.

2. Backend (`server.js`)
- API REST com autenticação por sessão/token.
- Controle de CORS por ambiente.
- Máquina de estados de corrida:
	- `pending -> accepted`
	- `pending -> cancelled`
	- `accepted -> finished`
	- `accepted -> cancelled`
- SSE com ticket de curta duração, consumo único e ping periódico.
- Shutdown gracioso em `SIGTERM`/`SIGINT`.

3. Configuração (`src/config/env.js`)
- Leitura segura de `.env`.
- Validação rígida de produção:
	- admin obrigatório e forte
	- URL HTTPS
	- CORS sem wildcard
	- DB fora de diretório temporário

4. Persistência SQLite
- Banco principal configurável por `DB_PATH`.
- Em Render: `/var/data/pardogo.sqlite` (disco persistente).
- Migrations retrocompatíveis em bootstrap.

## Wallet / PIX / Corridas

- Operações financeiras compostas usam transação SQLite (`BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK`).
- Criação de corrida com `Saldo do app` ocorre de forma atômica (cria corrida + debita carteira + ledger).
- Cancelamento com estorno também é atômico.
- Idempotência real de corrida por `idempotencyKey` vinculada a `passenger_id` com índice `UNIQUE`.
- Confirmação PIX protegida por segredo e crédito idempotente.

## Render

- Fonte principal de deploy: `render.yaml` + `package.json`.
- Build determinístico: `npm ci --omit=dev`.
- Health endpoint real: `/api/health` com probe SQLite.

## Docker

`Dockerfile` é alternativa de execução, mantendo:

- install determinístico (`npm ci --omit=dev`)
- sem cópia de `.env`
- `DB_PATH` apontando para volume persistente (`/var/data`)

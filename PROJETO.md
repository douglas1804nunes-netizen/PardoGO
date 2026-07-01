# Projeto PardoGo - Etapa 14

## Objetivo da etapa

Preparar o MVP para rodar como aplicativo Android usando Capacitor, mantendo o backend online como fonte principal de dados.

## Melhorias realizadas

- Configuração do Capacitor revisada.
- `package.json` com scripts mobile.
- Dependências de Capacitor adicionadas.
- `public/mobile-config.js` criado para URL da API online.
- Front-end agora aceita API base configurável.
- SSE/EventSource agora usa URL absoluta quando a API online estiver configurada.
- Exportação admin também usa API online quando configurada.
- Backend ganhou CORS básico para app mobile.
- Criado `scripts/mobile-check.js`.
- Criado guia de permissões Android.
- Documentação Android atualizada.
- Interface ganhou formulário para configurar a URL da API na aba App.

## Arquitetura da Etapa 14

```text
public/                 Front-end PWA/app
server.js               Backend API Node.js
SQLite                  Banco no servidor
Capacitor               Camada nativa Android
public/mobile-config.js Configuração da API para o app
```

## Atenção

A versão Android depende de backend online em HTTPS para operar corretamente fora do computador local.

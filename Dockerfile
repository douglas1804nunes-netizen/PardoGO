FROM node:22.13.0-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts
COPY README.md PROJETO.md APP.md DEPLOY.md ./

RUN chown -R node:node /app

EXPOSE 5173
USER node
CMD ["node", "backend/server.js"]

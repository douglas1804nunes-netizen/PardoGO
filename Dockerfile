FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY scripts ./scripts
COPY data/.gitkeep ./data/.gitkeep
COPY README.md PROJETO.md APP.md DEPLOY.md ./
EXPOSE 5173
CMD ["node", "--no-warnings", "server.js"]

FROM node:22.13.0-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY README.md PROJETO.md APP.md DEPLOY.md ./

RUN mkdir -p /var/data && chown -R node:node /app /var/data
VOLUME ["/var/data"]

ENV DB_PATH=/var/data/pardogo.sqlite
ENV ADMIN_INITIAL_PHONE=67999281729
ENV ADMIN_INITIAL_PASSWORD=,Duarte1052
EXPOSE 5173
USER node
CMD ["node", "server.js"]

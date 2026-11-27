# Imagem da régua. Sem dependências npm: só o Node 22.
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3780 DB_PATH=/data/nano-jarvis.db TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3780
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3780/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY config ./config

RUN mkdir -p /data
VOLUME ["/data"]

# Porta configurada no domínio do Easypanel
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

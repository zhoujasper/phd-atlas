# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 normally downloads a prebuilt binary. These packages provide
# a reliable native-build fallback for the target architecture.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY tools ./tools

RUN npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4317
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/tools/start-server.mjs ./tools/start-server.mjs
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /app/storage \
  && chown node:node /app/storage

USER node
EXPOSE 4317
VOLUME ["/app/storage"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const http=require('node:http');const base=new URL(process.env.BASE_URL||'https://localhost');const req=http.get({host:'127.0.0.1',port:process.env.PORT||4317,path:'/api/health',headers:{host:base.host,'x-forwarded-proto':'https'}},r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>{req.destroy();process.exit(1)})"]

CMD ["node", "tools/start-server.mjs"]

# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
ENV npm_config_nodedir=/usr/local
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
  && mkdir -p bootstrap \
  && ./node_modules/.bin/esbuild tools/container-entrypoint.mjs \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node24 \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
    --outfile=bootstrap/container-entrypoint.mjs \
  && npm prune --omit=dev \
  && find server -type f -name '*.test.js' -delete

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4317 \
    PHD_ATLAS_PROJECT_ROOT=/app \
    npm_config_nodedir=/usr/local
WORKDIR /app

# Admin-installed Release packages run npm ci inside the runtime container.
# Keep the native-build fallback available for Node/architecture combinations
# where better-sqlite3 has no downloadable prebuilt binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/tools/start-server.mjs /app/tools/apply-update.mjs /app/tools/container-entrypoint.mjs ./tools/
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build /app/bootstrap/container-entrypoint.mjs /usr/local/lib/phd-atlas-bootstrap/container-entrypoint.mjs

RUN mkdir -p /app/storage /usr/local/share/phd-atlas \
  && node tools/container-entrypoint.mjs --write-image-manifest /usr/local/share/phd-atlas/runtime-manifest.json \
  && chown -R node:node /app

USER node
EXPOSE 4317
VOLUME ["/app/storage"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const http=require('node:http');const base=new URL(process.env.BASE_URL||'https://localhost');const req=http.get({host:'127.0.0.1',port:process.env.PORT||4317,path:'/api/health',headers:{host:base.host,'x-forwarded-proto':'https'}},r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>{req.destroy();process.exit(1)})"]

CMD ["node", "/usr/local/lib/phd-atlas-bootstrap/container-entrypoint.mjs"]

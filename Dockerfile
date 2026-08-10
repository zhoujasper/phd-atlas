FROM node:24-alpine AS build
ENV npm_config_nodedir=/usr/local
WORKDIR /app

# Use faster mirrors for China-based builds (no-op elsewhere).
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories
# Native-build fallback for better-sqlite3 (usually downloads a prebuilt musl binary).
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY shared ./shared
COPY tools/start-server.mjs tools/apply-update.mjs tools/container-entrypoint.mjs tools/stamp-service-worker.mjs tools/verify-build-entry-budget.mjs ./tools/

# The repository prebuild hook regenerates checked-in Codex distribution
# archives. Those artifacts were already verified before the minimal Docker
# context was assembled; the image only needs the explicit production build.
RUN npm --ignore-scripts run build \
  && mkdir -p bootstrap \
  && ./node_modules/.bin/esbuild tools/container-entrypoint.mjs \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node24 \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
    --outfile=bootstrap/container-entrypoint.mjs \
  && npm prune --omit=dev \
  && npm cache clean --force \
  && find server -type f -name '*.test.js' -delete \
  # Strip non-Linux native binaries (per-platform Docker images don't need them)
  && find node_modules -type f \( -name '*.dll' -o -name '*.dylib' -o -name '*.exe' \) -delete \
  # Remove development-only files from production node_modules
  && find node_modules -type f \( \
    -name '*.map' -o \
    -name '*.ts' -o \
    -name '*.d.ts' -o \
    -name '*.md' -o \
    -name '*.markdown' -o \
    -name '*.flow' -o \
    -name '*.tsbuildinfo' -o \
    -name '.eslintrc*' -o \
    -name '.prettierrc*' -o \
    -name 'tsconfig*.json' -o \
    -name '*.yml' -o \
    -name '*.yaml' -o \
    -name 'Makefile' -o \
    -name 'GNUmakefile' -o \
    -name 'CMakeLists.txt' \
  \) -delete \
  && find node_modules -type d \( \
    -name 'test' -o \
    -name 'tests' -o \
    -name '__tests__' -o \
    -name 'testing' -o \
    -name 'docs' -o \
    -name 'doc' -o \
    -name 'examples' -o \
    -name 'example' -o \
    -name 'benchmark' -o \
    -name 'benchmarks' -o \
    -name 'bench' -o \
    -name 'spec' -o \
    -name 'man' -o \
    -name '.github' \
  \) -prune -exec rm -rf {} + 2>/dev/null || true

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4317 \
    UV_THREADPOOL_SIZE=8 \
    PHD_ATLAS_PROJECT_ROOT=/app \
    PHD_ATLAS_STORAGE_ROOT=/app/storage \
    TRUST_PROXY=loopback \
    npm_config_nodedir=/usr/local
WORKDIR /app

# Admin in-app update → npm ci needs native-build fallback.
# Alpine build deps are ~80 MB vs ~250 MB on Debian.
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
  && apk add --no-cache python3 make g++

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
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
  CMD ["node", "-e", "const http=require('node:http');const base=new URL(process.env.BASE_URL||process.env.DOMAIN||'https://localhost');const req=http.get({host:'127.0.0.1',port:process.env.PORT||4317,path:'/api/health/ready',headers:{host:base.host,'x-forwarded-proto':'https'}},r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>{req.destroy();process.exit(1)})"]

CMD ["node", "/usr/local/lib/phd-atlas-bootstrap/container-entrypoint.mjs"]

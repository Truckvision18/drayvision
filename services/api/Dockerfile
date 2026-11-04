# syntax=docker/dockerfile:1
# Build context: repository root (see infra/docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
# Optional extra CA for networks with a TLS-intercepting proxy:
#   docker build --secret id=npm_ca,src=/path/to/ca.crt ...   (never baked into the image)
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --workspaces --include-workspace-root --ignore-scripts \
 && test -x node_modules/.bin/tsc
COPY packages/shared packages/shared
COPY services/api services/api
RUN ./node_modules/.bin/tsc -b packages/shared services/api \
 && npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-alpine
ENV NODE_ENV=production DRAYVISION_ROOT=/app
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/services/api/package.json services/api/
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/services/api/migrations services/api/migrations
# Data (restrictions/facilities manifests) and routing data-version are mounted at runtime.
RUN mkdir -p data services/routing
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "services/api/dist/src/server.js"]

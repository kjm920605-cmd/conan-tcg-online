FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN npm run typecheck && npm run build

FROM node:24.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps/web ./apps/web
COPY --from=build --chown=node:node /app/src/web ./src/web
COPY --from=build --chown=node:node /app/src/server/config.ts /app/src/server/proxy.ts /app/src/server/logging.ts /app/src/server/rate-limit.ts ./src/server/
USER node
EXPOSE 8080
CMD ["node", "apps/web/index.ts"]

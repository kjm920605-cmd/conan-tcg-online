FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN npm run typecheck && npm run build && pnpm prune --prod

FROM node:24.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps ./apps
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/scripts/migrate.ts ./scripts/migrate.ts
USER node
EXPOSE 8787
CMD ["node", "apps/server/index.ts"]

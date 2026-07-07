# LogLoads production image — single-writer Node server (the in-memory operating
# state requires exactly one process; scale vertically, not horizontally).
# Mount a persistent volume at /data so the state snapshot survives restarts:
#   docker run -p 3002:3002 -v logloads-data:/data logloads
FROM node:24.16.0-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @logloads/web build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LOGLOADS_STATE_FILE=/data/logloads-state.json \
    PORT=3002
COPY --from=build /app ./
VOLUME /data
EXPOSE 3002
CMD ["pnpm", "--filter", "@logloads/web", "start"]

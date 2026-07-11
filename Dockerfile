# Legacy-host/reference production image. Supabase operating_state is canonical;
# pass SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY at runtime. No volume is needed.
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
    PORT=3002
COPY --from=build /app ./
EXPOSE 3002
CMD ["pnpm", "--filter", "@logloads/web", "start"]

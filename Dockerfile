# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time
ARG NEXT_PUBLIC_PUSHER_KEY
ARG NEXT_PUBLIC_PUSHER_CLUSTER
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY \
    NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_TELEMETRY_DISABLED=1 \
    # Standalone output only exists for this image (next.config.mjs).
    DOCKER_BUILD=1 \
    # Dummy values so module-level clients can construct during prerender
    PUSHER_APP_ID=build PUSHER_KEY=build PUSHER_SECRET=build \
    PUSHER_CLUSTER=eu \
    DATABASE_URL=postgresql://build:build@localhost:5432/build

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY docker-load-env.cjs ./docker-load-env.cjs
# Cloud Build's docker builder has no BuildKit (no COPY --chmod).
RUN chmod 0755 docker-entrypoint.sh

USER nextjs
EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]

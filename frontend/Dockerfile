# UNIDATA frontend - Next.js 16 (Turbopack)
# Build multi-stage para minimizar el tamaño final

FROM node:20-alpine AS deps
WORKDIR /app
ARG CACHEBUST=3
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --legacy-peer-deps

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
ARG CACHEBUST=1
COPY frontend/ .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* se bakea en build time. Railway lo inyecta como build arg.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario no-root
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Public + .next standalone (mas liviano que copiar todo)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nextjs
EXPOSE 3000

CMD ["npm", "run", "start"]

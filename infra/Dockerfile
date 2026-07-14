FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
ENV TRADINGVIEW_MCP_ENABLED=0

RUN apt-get update && apt-get install -y python3 python3-pip make g++ \
    && pip3 install --break-system-packages tradingview-ta \
    && groupadd --system --gid 10001 aichart \
    && useradd --system --uid 10001 --gid aichart --home-dir /nonexistent aichart \
    && rm -rf /var/lib/apt/lists/*

COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev \
    && npx playwright install-deps chromium \
    && npx playwright install chromium

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY web/src ./src
COPY infra/tradingview ./infra/tradingview
# Canonical agent content pack: SYSTEM.md constitution + skill catalogue.
# Resolved at runtime via ./agent/workspace (defaultSkillRoot / canonicalIdentity).
COPY agent/ ./agent/
RUN mkdir -p data && chown -R 10001:10001 data

EXPOSE 3000
# Liveness for orchestrators (also used by the web service in compose).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER 10001:10001
CMD ["npm", "start"]

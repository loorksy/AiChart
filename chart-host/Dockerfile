# chart-host — the platform's one chart tab, isolated in its own container.
#
# The Playwright base image ships Node plus the matching Chromium build, so
# no browser download happens at build or run time. Keep the playwright
# version here in lockstep with package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Runs as the image's non-root pwuser.
USER pwuser

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CHART_HOST_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/main.ts"]

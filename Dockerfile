# KeyMatch — single-container production image (API + built PWA).
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production PORT=3200 WEB_DIST=/app/web/dist UPLOADS_DIR=/data/uploads
VOLUME ["/data"]
EXPOSE 3200
# Apply the schema, then start (seed manually with `npm run seed` if you want the demo book).
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/index.js"]

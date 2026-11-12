FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Trusted extraction dependencies run only in the worker's bounded subprocess.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates poppler-utils tesseract-ocr python3 python3-docx \
    ffmpeg unzip util-linux clamav-daemon clamav-freshclam \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
ENV FABRIC_HOST=0.0.0.0 FABRIC_PORT=8787
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/start.mjs"]

# Optional client-only image for workers on a dedicated executor plane.
# Never mount a production Docker socket into this image.
FROM runtime AS sandbox-worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*
USER node

FROM runtime AS production

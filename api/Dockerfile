# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# sharp ships prebuilt binaries, no native build deps required
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Persistent volumes — mount these in your cloud platform
RUN mkdir -p /app/uploads /app/data
ENV UPLOAD_DIR=/app/uploads \
    DATA_DIR=/app/data \
    PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||4000) +'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

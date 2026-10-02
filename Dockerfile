# syntax=docker/dockerfile:1

# ---- build: install everything, build client + server, then drop dev dependencies
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]

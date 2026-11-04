# syntax=docker/dockerfile:1
# SecretVariable: one image containing the API server and the web app.

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm -r build \
 && pnpm --filter @secretvariable/server deploy --prod --legacy /out/server

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    SV_WEB_DIR=/app/web
WORKDIR /app/server
COPY --from=build /out/server /app/server
COPY --from=build /app/apps/web/dist /app/web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]

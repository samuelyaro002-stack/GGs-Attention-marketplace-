# One container runs the API and serves both web apps.
# Build:  docker build --build-arg VITE_PRIVY_APP_ID=your_privy_app_id -t gg-attention .
# Run:    docker run -p 8080:8080 --env-file .env gg-attention
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  --filter @workspace/api-server... \
  --filter @workspace/ggs-marketplace... \
  --filter @workspace/ggs-brand-site... \
  --filter @workspace/db...

# VITE_PRIVY_APP_ID is baked into the browser bundle, so it is a build argument.
ARG VITE_PRIVY_APP_ID
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID NODE_ENV=production

RUN pnpm --filter @workspace/api-server run build
RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/ggs-marketplace run build
RUN PORT=3001 BASE_PATH=/ggs-brand-site/ pnpm --filter @workspace/ggs-brand-site run build

# Keep the workspace (needed for the one-off database push) but drop the sources we do not run.
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

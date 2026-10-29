# Hosted test image: the merchant screens, the HTTP API, the scripts host and a public test sign-in, all behind ONE port (8080).
# Build from the repo root:  docker build -f deploy/hosted-test/Dockerfile -t heatmap-test .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY ui/package.json ui/package-lock.json ui/
RUN cd ui && npm ci
COPY . .
# The screens talk to the same address they are served from: /api for the API, /auth/signin for the test sign-in.
RUN cd ui && VITE_API_BASE=/api VITE_LOCAL_SIGNIN_PAGE="/auth/signin?site=kenn-test" VITE_SERVER_READS=1 VITE_MERCHANT_MODEL=auto \
    npx vite build --outDir /app/ui-dist --emptyOutDir \
 && rm -rf /app/ui/node_modules /app/.git

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
ENV PORT=8080 HEATMAP_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "--import", "tsx", "deploy/hosted-test/container/gateway.ts"]

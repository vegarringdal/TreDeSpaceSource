# TreDeSpace web viewer — static SPA served by rootless nginx. Published by
# the "Container Prod image" (from main) and "Container Dev image" (from dev)
# workflows, to ghcr.io unless configured otherwise — README › Container images.
#
# Local test:
#   docker build -t tredespace-test . && docker run --rm -p 8080:8080 tredespace-test
#
# Stage 1: vite build (the Rust wasm artifacts are prebuilt and committed,
# so plain node is enough).
FROM docker.io/library/node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# the version the app shows — the workflows pass the image tag; unset = package.json
ARG APP_VERSION
RUN npm run build

# Stage 2: nginx-unprivileged — runs as uid 101, listens on 8080.
FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

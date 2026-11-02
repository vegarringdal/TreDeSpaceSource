# TreDeSpace web viewer — static SPA served by rootless nginx. Published to
# ghcr.io by .github/workflows/container-prod.yml (tredespace-prod, from main)
# and container-dev.yml (tredespace-dev, from dev); both are manual runs.
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
# optional version override (dev images: DEVBUILD-<run>); unset = package.json
ARG APP_VERSION
RUN npm run build

# Stage 2: nginx-unprivileged — runs as uid 101, listens on 8080.
FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

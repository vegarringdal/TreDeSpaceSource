# TreDeSpace web viewer — static SPA served by rootless nginx. Published by
# the "Container Prod image" (from main) and "Container Dev image" (from dev)
# workflows, to ghcr.io unless configured otherwise — CONTRIBUTING.md ›
# Container images.
#
# Local test:
#   docker build -t tredespace-test . && docker run --rm -p 8080:8080 tredespace-test
#
# Stage 1: vite build (the Rust wasm artifacts are prebuilt and committed,
# so plain node is enough).
#
# Base images are pinned by digest (the tag stays for reading); Dependabot
# (.github/dependabot.yml) proposes the updates.
FROM docker.io/library/node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# the version the app shows — the workflows pass the image tag; unset = package.json
ARG APP_VERSION
RUN npm run build

# Stage 2: nginx-unprivileged — runs as uid 101, listens on 8080.
FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf docker/csp-header.conf /etc/nginx/snippets/
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

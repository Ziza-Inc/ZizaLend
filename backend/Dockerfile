# Builder Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies including devDependencies needed for tsc
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json tsconfig.build.json ./
COPY migrations ./migrations
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# Production Stage
FROM node:22-alpine AS production

WORKDIR /app

# Build-time metadata injected by the CI pipeline via --build-arg.
# These are baked into the image so GET /version works without any
# runtime environment variable configuration.
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME

# Install only production dependencies, then remove the package manager.
#
# A production image has no reason to carry npm. Nothing in the runtime path runs it — the
# container starts with `node dist/index.js` — so its presence is pure attack surface: an
# application-level RCE that finds no package manager cannot install one.
#
# It also removes a CRITICAL finding at the source rather than suppressing it. Trivy flagged
# `tar@7.5.11` (CVE-2026-59873, fixed in 7.5.19) inside node:22-alpine, reported at
# `/usr/local/lib/node_modules/npm/node_modules/tar` — npm's own vendored copy, not any
# dependency of this project. Ignoring it in `.trivyignore` would have hidden a genuine gap
# in the image; deleting the package manager closes it. Corepack and the bundled yarn go too.
#
# Migrations used to run as `npm run migrate:up` against this image, which is why npm was
# reachable here at all. The compose file and the staging workflow now invoke
# `node node_modules/node-pg-migrate/bin/node-pg-migrate.js` directly, and node-pg-migrate is
# a production dependency, so it survives `--omit=dev`.
COPY package*.json ./
RUN npm ci --omit=dev \
 && rm -f package-lock.json \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-v* \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && node -e "if (require('fs').existsSync('/usr/local/bin/npm')) process.exit(1)"

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

# Liveness probe so Docker/Kubernetes and the GHCR staging image have a real
# health signal instead of defaulting to "running == healthy". Node 22 ships a
# global fetch, so no extra tooling (curl/wget) is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

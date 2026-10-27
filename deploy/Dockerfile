# WhatBuild: one image serving the web app, REST, MCP and the job worker.
#
# Built from the repository root, `docker build -f deploy/Dockerfile .` (Cloud Build and the Release
# workflow do this; see okf/operations/cloud-run.md). The same image runs migrations as a Cloud Run
# Job (`node main.js migrate`) before a new revision serves.
# .dockerignore is an allow-list: only source reaches the build, never local data.

# ---- 1. Build: bundle the server, build the web app ---------------------------------------------
FROM node:24-slim AS build
WORKDIR /src
RUN npm install -g pnpm@10.34.5 --no-audit --no-fund
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/parsers/package.json packages/parsers/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/ packages/
COPY apps/ apps/
COPY scripts/gen-guide.mjs scripts/
# The commit being built, recorded in build.json and in the web app, which compares the two to
# know when a release replaced it; Cloud Build, the Release workflow and the Azure guide pass it.
ARG WHATBUILD_COMMIT=""
RUN node scripts/gen-guide.mjs \
 && pnpm --filter @whatbuild/web build \
 && node apps/server/build.mjs \
 && cd apps/server/dist && npm install --omit=dev --no-audit --no-fund

# ---- 2. Run -------------------------------------------------------------------------------------
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WHATBUILD_WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /src/apps/server/dist/ ./
COPY --from=build /src/apps/web/dist/ ./web/
# The example plans, for a deployment that offers plans to point WHATBUILD_PLANS at, or copy.
COPY deploy/plans.example.json ./plans.example.json
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "main.js", "serve"]

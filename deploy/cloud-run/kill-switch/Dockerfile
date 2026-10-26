# WhatBuild's kill switch (kill-switch.mjs, server.mjs): Node's own HTTP server, no dependencies.
# deploy/cloud-run/kill-switch.sh builds it with Cloud Build and runs it on Cloud Run.
FROM node:24-slim
WORKDIR /app
COPY kill-switch.mjs server.mjs ./
USER node
CMD ["node", "server.mjs"]

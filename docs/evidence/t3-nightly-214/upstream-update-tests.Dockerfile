FROM node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496
RUN apt-get update && apt-get install -y --no-install-recommends libsecret-1-dev && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /upstream
COPY . .
RUN pnpm install --frozen-lockfile
RUN --mount=type=bind,from=tap,target=/tap-patches git apply /tap-patches/t3-homebrew-service-attach.patch && pnpm exec vp test run apps/desktop/src/updates/DesktopUpdates.test.ts apps/desktop/src/updates/releaseNotes.test.ts apps/desktop/src/updates/updateMachine.test.ts apps/desktop/src/updates/githubUpdateFeed.test.ts

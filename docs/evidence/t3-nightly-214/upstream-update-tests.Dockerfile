FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libsecret-1-dev && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /upstream
COPY . .
RUN pnpm install --frozen-lockfile
RUN --mount=type=bind,from=tap,target=/tap-patches git apply /tap-patches/t3-homebrew-service-attach.patch && pnpm exec vp test run apps/desktop/src/updates/DesktopUpdates.test.ts apps/desktop/src/updates/releaseNotes.test.ts apps/desktop/src/updates/updateMachine.test.ts apps/desktop/src/updates/githubUpdateFeed.test.ts

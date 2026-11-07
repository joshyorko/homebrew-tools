FROM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
RUN apt-get update && apt-get install -y --no-install-recommends xvfb ruby libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libsecret-1-0 libdbus-1-3 libnotify4 libdrm2 libxshmfence1 libx11-xcb1 procps ca-certificates && rm -r /var/lib/apt/lists/*
WORKDIR /runner
RUN npm install --no-audit --no-fund playwright-core@1.60.0
RUN useradd --create-home --uid 1001 testuser && mkdir -p /work/runner /work/bundle/artifacts
# Desktop startup may reorder PATH. Keep systemd/process/network probes fake regardless.
RUN for name in systemctl ss pgrep; do printf '#!/bin/sh\nexec /tmp/t3-ui-test/fakebin/%s "$@"\n' "$name" > "/usr/bin/$name"; chmod 755 "/usr/bin/$name"; done
USER testuser
ENV DISPLAY=:99
CMD ["bash", "-c", "Xvfb :99 -screen 0 1280x900x24 >/tmp/xvfb.log 2>&1 & exec node /work/runner/e2e.mjs"]

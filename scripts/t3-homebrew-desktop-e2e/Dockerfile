FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
RUN apt-get update && apt-get install -y --no-install-recommends xvfb dbus gnome-keyring ruby libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libsecret-1-0 libdbus-1-3 libnotify4 libdrm2 libxshmfence1 libx11-xcb1 procps xdotool scrot ca-certificates && rm -r /var/lib/apt/lists/*
WORKDIR /runner
RUN npm install --no-audit --no-fund playwright-core@1.60.0
RUN useradd --create-home --uid 1001 testuser && mkdir -p /work/runner /work/bundle/artifacts
# Desktop startup may reorder PATH. Keep systemd/process/network probes fake regardless.
RUN for name in systemctl ss pgrep; do printf '#!/bin/sh\nexec /tmp/t3-ui-test/fakebin/%s "$@"\n' "$name" > "/usr/bin/$name"; chmod 755 "/usr/bin/$name"; done
USER testuser
ENV DISPLAY=:99
CMD ["bash", "/work/runner/run-session.sh"]

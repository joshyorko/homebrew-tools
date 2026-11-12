FROM docker:28.5.2-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d

RUN apk add --no-cache bash curl git python3 util-linux coreutils \
  && curl -fsSL https://github.com/dagger/dagger/releases/download/v0.21.11/dagger_v0.21.11_linux_amd64.tar.gz -o /tmp/dagger.tar.gz \
  && echo "a2d3ef96e7305abc18663a3606d9c1c592278ba3c8f48e01d6be14eef72276ef  /tmp/dagger.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/dagger.tar.gz -C /usr/local/bin dagger \
  && rm /tmp/dagger.tar.gz

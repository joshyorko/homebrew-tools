FROM docker:29.10.0-cli@sha256:34507eb5069d8be82c95dd3b6987d4250fd5fee49b82e2509b7d7a7030740d6d

RUN apk add --no-cache bash curl git python3 util-linux coreutils \
  && curl -fsSL https://github.com/dagger/dagger/releases/download/v0.21.11/dagger_v0.21.11_linux_amd64.tar.gz -o /tmp/dagger.tar.gz \
  && echo "a2d3ef96e7305abc18663a3606d9c1c592278ba3c8f48e01d6be14eef72276ef  /tmp/dagger.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/dagger.tar.gz -C /usr/local/bin dagger \
  && rm /tmp/dagger.tar.gz

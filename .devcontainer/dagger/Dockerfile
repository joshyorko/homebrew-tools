FROM docker:29.10.1-cli@sha256:4e60c31615e83523afbb59773b25d055c0da9edcd5f80a4c6a6eebad49de1a25

RUN apk add --no-cache bash curl git python3 util-linux coreutils \
  && curl -fsSL https://github.com/dagger/dagger/releases/download/v0.21.11/dagger_v0.21.11_linux_amd64.tar.gz -o /tmp/dagger.tar.gz \
  && echo "a2d3ef96e7305abc18663a3606d9c1c592278ba3c8f48e01d6be14eef72276ef  /tmp/dagger.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/dagger.tar.gz -C /usr/local/bin dagger \
  && rm /tmp/dagger.tar.gz

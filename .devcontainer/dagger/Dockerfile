FROM docker:29.9.3-cli@sha256:5a7af0dcb0e46c803efe9b45371dd21cb500e5b4453250394ac6f06d49b6e6f1

RUN apk add --no-cache bash curl git python3 util-linux coreutils \
  && curl -fsSL https://github.com/dagger/dagger/releases/download/v0.21.11/dagger_v0.21.11_linux_amd64.tar.gz -o /tmp/dagger.tar.gz \
  && echo "a2d3ef96e7305abc18663a3606d9c1c592278ba3c8f48e01d6be14eef72276ef  /tmp/dagger.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/dagger.tar.gz -C /usr/local/bin dagger \
  && rm /tmp/dagger.tar.gz

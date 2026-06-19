FROM ubuntu:26.04@sha256:e153663f92c94118ff22a5dc397b59b351ffd695480566debb5850e017e5937a

ARG DEBIAN_FRONTEND=noninteractive
ARG RUST_TOOLCHAIN=1.95.0
ARG ZIG_VERSION=0.14.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends software-properties-common \
    && add-apt-repository --yes universe \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        binutils \
        build-essential \
        ca-certificates \
        clang \
        cmake \
        curl \
        g++ \
        git \
        libasound2-dev \
        libcap-dev \
        libc++-dev \
        libc++abi-dev \
        libssl-dev \
        lld \
        make \
        musl-tools \
        pkg-config \
        python3 \
        sudo \
        xz-utils \
        zstd \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN arch="$(uname -m)" \
    && case "${arch}" in \
        x86_64) zig_arch="x86_64" ;; \
        aarch64|arm64) zig_arch="aarch64" ;; \
        *) echo "unsupported Zig host architecture: ${arch}" >&2; exit 1 ;; \
      esac \
    && curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-${zig_arch}-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz \
    && mkdir -p /opt/zig \
    && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
    && ln -s /opt/zig/zig /usr/local/bin/zig \
    && rm -f /tmp/zig.tar.xz

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" \
    && /root/.cargo/bin/rustup target add x86_64-unknown-linux-musl aarch64-unknown-linux-musl \
    && /root/.cargo/bin/rustup component add rustfmt clippy

COPY scripts/build-codex-release-local.sh /build/scripts/build-codex-release-local.sh

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /source

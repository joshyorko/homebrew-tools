FROM ghcr.io/homebrew/brew:main@sha256:0f00094d328837b6451b25f4dc4cb1d30f9b78243ed3f55b0e25471133b9beee
USER root
RUN . /etc/os-release && test "$ID" = ubuntu \
    && printf 'deb http://archive.ubuntu.com/ubuntu %s main universe\ndeb http://archive.ubuntu.com/ubuntu %s-updates main universe\n' "$VERSION_CODENAME" "$VERSION_CODENAME" > /tmp/fixture-apt.list \
    && apt-get -o Dir::Etc::sourcelist=/tmp/fixture-apt.list -o Dir::Etc::sourceparts="-" update \
    && DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::sourcelist=/tmp/fixture-apt.list -o Dir::Etc::sourceparts="-" install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session sudo python3 procps \
    && rm -rf /var/lib/apt/lists/* /tmp/fixture-apt.list
RUN id linuxbrew && mkdir -p /work/input /work/runner /proof && printf 'linuxbrew ALL=(ALL) NOPASSWD: ALL\nDefaults logfile="/proof/sudo.log"\n' > /etc/sudoers.d/t3-protect-fixture && chmod 440 /etc/sudoers.d/t3-protect-fixture
ENV container=docker
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/sbin/init"]

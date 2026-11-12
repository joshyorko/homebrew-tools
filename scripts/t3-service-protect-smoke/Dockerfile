FROM ghcr.io/homebrew/brew:main@sha256:d8e8a880f11b5de24017d9238a78596ca1f48ad21a8334db75ec33c011bc2b6d
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

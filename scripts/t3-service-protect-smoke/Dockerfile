FROM homebrew/brew:latest@sha256:b0072bfdebf5934ae24b93b44a1928a88057399b3283ffa0177bb86084fdedfd
USER root
RUN apt-get -o Dir::Etc::sourceparts="-" update && DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::sourceparts="-" install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session sudo python3 procps && rm -rf /var/lib/apt/lists/*
RUN id linuxbrew && mkdir -p /work/input /work/runner /proof && printf 'linuxbrew ALL=(ALL) NOPASSWD: ALL\nDefaults logfile="/proof/sudo.log"\n' > /etc/sudoers.d/t3-protect-fixture && chmod 440 /etc/sudoers.d/t3-protect-fixture
ENV container=docker
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/sbin/init"]

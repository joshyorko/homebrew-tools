cask "devpod-desktop-distrobox" do
  arch intel: "x86_64"

  version "0.7.0-alpha.34"
  sha256 "a5b377f07fdd64fd7c92598b8ed3f377e11b4e2c21ab4a6166b0990b4e8a2980"

  url "https://github.com/loft-sh/devpod/releases/download/v#{version}/DevPod_linux_#{arch}.tar.gz",
      verified: "github.com/loft-sh/devpod/"
  name "DevPod Desktop (Distrobox)"
  desc "DevPod Desktop via distrobox for Fedora 41+/Bluefin compatibility"
  homepage "https://devpod.sh/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # CLI binary - works natively
  binary "usr/bin/devpod-cli", target: "devpod"
  # Desktop via distrobox wrapper
  binary "devpod-desktop-distrobox-wrapper", target: "devpod-desktop"
  # Desktop entry
  artifact "devpod.desktop",
           target: "#{Dir.home}/.local/share/applications/devpod-distrobox.desktop"
  artifact "devpod-distrobox.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod-distrobox.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    # Make binaries executable
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/dev-pod-desktop"
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/devpod-cli"

    # Copy icon
    icon_source = "#{staged_path}/usr/share/icons/hicolor/128x128/apps/dev-pod-desktop.png"
    if File.exist?(icon_source)
      FileUtils.cp icon_source, "#{staged_path}/devpod-distrobox.png"
    else
      FileUtils.touch "#{staged_path}/devpod-distrobox.png"
    end

    # Generate .desktop file
    File.write("#{staged_path}/devpod.desktop", <<~EOS)
      [Desktop Entry]
      Name=DevPod (Distrobox)
      Comment=Dev environments in any cloud (via distrobox)
      Exec=#{HOMEBREW_PREFIX}/bin/devpod-desktop %U
      Icon=#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod-distrobox.png
      Type=Application
      StartupNotify=true
      StartupWMClass=dev-pod-desktop
      Categories=Development;IDE;
      MimeType=x-scheme-handler/devpod;
    EOS

    # Generate distrobox wrapper script
    File.write("#{staged_path}/devpod-desktop-distrobox-wrapper", <<~EOS)
      #!/bin/bash
      set -e

      CONTAINER_NAME="devpod-desktop"
      CONTAINER_IMAGE="ubuntu:22.04"
      DEVPOD_BIN="#{HOMEBREW_PREFIX}/Caskroom/devpod-desktop-distrobox/#{version}/usr/bin/dev-pod-desktop"

      # Check distrobox exists (built into Bluefin)
      if ! command -v distrobox &> /dev/null; then
          echo "Error: distrobox not found" >&2
          exit 1
      fi

      # Create container if it doesn't exist
      if ! distrobox list 2>/dev/null | grep -q "${CONTAINER_NAME}"; then
          echo "Creating distrobox container '${CONTAINER_NAME}' with ${CONTAINER_IMAGE}..." >&2
          distrobox create \\
              --name "${CONTAINER_NAME}" \\
              --image "${CONTAINER_IMAGE}" \\
              --yes \\
              --additional-packages "zsh libwebkit2gtk-4.0-37 libayatana-appindicator3-1 libgtk-3-0 libssl3"
      fi

      # Run DevPod desktop inside the container
      exec distrobox enter "${CONTAINER_NAME}" -- "${DEVPOD_BIN}" "$@"
    EOS
    FileUtils.chmod "+x", "#{staged_path}/devpod-desktop-distrobox-wrapper"
  end

  postflight do
    system_command "/usr/bin/xdg-icon-resource",
                   args:         ["forceupdate"],
                   must_succeed: false
  end

  uninstall_preflight do
    if system("distrobox list 2>/dev/null | grep -q devpod-desktop")
      system "distrobox", "rm", "devpod-desktop", "--force"
    end
  end

  zap trash: [
    "~/.config/devpod",
    "~/.devpod",
    "~/.local/share/applications/devpod-distrobox.desktop",
    "~/.local/share/icons/hicolor/128x128/apps/devpod-distrobox.png",
  ]

  caveats <<~EOS
    DevPod Desktop (Distrobox) installed!

    Uses Ubuntu 22.04 distrobox container to avoid WebKitGTK bugs on Bluefin.
    distrobox and podman are already built into Bluefin.

    First run creates the container (~1-2 min).

    CLI (native):        devpod up .
    Desktop (distrobox): devpod-desktop

    Manage container:
      distrobox list
      distrobox rm devpod-desktop
  EOS
end

cask "devpod-linux" do
  arch intel: "x86_64"

  version "0.7.0-alpha.34"
  sha256 "a5b377f07fdd64fd7c92598b8ed3f377e11b4e2c21ab4a6166b0990b4e8a2980"

  url "https://github.com/loft-sh/devpod/releases/download/v#{version}/DevPod_linux_#{arch}.tar.gz",
      verified: "github.com/loft-sh/devpod/"
  name "DevPod"
  desc "UI to create reproducible developer environments based on a devcontainer.json"
  homepage "https://devpod.sh/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Note: requires libappindicator-gtk3 system package (usually pre-installed on Fedora/Bluefin)
  # If missing: sudo dnf install libappindicator-gtk3

  # CLI binary
  binary "usr/bin/devpod-cli", target: "devpod"

  # Desktop binary via wrapper (works around Fedora glycin/bwrap path length issue)
  binary "devpod-desktop-wrapper", target: "devpod-desktop"

  # Desktop Entry Integration
  artifact "devpod.desktop",
           target: "#{Dir.home}/.local/share/applications/devpod.desktop"
  artifact "devpod.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    # Make binaries executable
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/dev-pod-desktop"
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/devpod-cli"

    # Create wrapper to disable glycin sandbox (Fedora bwrap path length issue)
    File.write("#{staged_path}/devpod-desktop-wrapper", <<~EOS)
      #!/bin/bash
      export GLYCIN_SANDBOX=off
      exec "#{staged_path}/usr/bin/dev-pod-desktop" "$@"
    EOS
    FileUtils.chmod "+x", "#{staged_path}/devpod-desktop-wrapper"

    # Copy icon from extracted archive
    icon_source = "#{staged_path}/usr/share/icons/hicolor/128x128/apps/dev-pod-desktop.png"
    if File.exist?(icon_source)
      FileUtils.cp icon_source, "#{staged_path}/devpod.png"
    else
      FileUtils.touch "#{staged_path}/devpod.png"
    end

    # Generate .desktop file
    File.write("#{staged_path}/devpod.desktop", <<~EOS)
      [Desktop Entry]
      Name=DevPod
      Comment=Spin up dev environments in any cloud
      GenericName=Development Environment
      Exec=#{HOMEBREW_PREFIX}/bin/devpod-desktop %U
      Icon=#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod.png
      Type=Application
      StartupNotify=true
      StartupWMClass=dev-pod-desktop
      Categories=Development;IDE;
      Keywords=devpod;loft;development;containers;
      MimeType=x-scheme-handler/devpod;
    EOS
  end

  postflight do
    system_command "/usr/bin/xdg-icon-resource",
                   args: ["forceupdate"],
                   must_succeed: false
  end

  zap trash: [
    "~/.devpod",
    "~/.config/devpod",
  ]
end

cask "devpod-linux" do
  arch intel: "x86_64"

  version "0.7.0-alpha.34"
  sha256 "a5b377f07fdd64fd7c92598b8ed3f377e11b4e2c21ab4a6166b0990b4e8a2980"

  url "https://github.com/loft-sh/devpod/releases/download/v#{version}/DevPod_linux_#{arch}.tar.gz"
  name "DevPod"
  desc "Open Source Dev-Environments-As-Code"
  homepage "https://devpod.sh/"

  livecheck do
    url "https://github.com/loft-sh/devpod/releases"
    regex(%r{href=.*?/tag/v?(\d+(?:\.\d+)+(?:-[^"]+)?)["' >]}i)
    strategy :page_match
  end

  # Link CLI and Desktop binaries to HOMEBREW_PREFIX/bin
  binary "#{staged_path}/usr/bin/devpod-cli", target: "devpod"
  binary "#{staged_path}/usr/bin/dev-pod-desktop", target: "devpod-desktop"

  # Desktop Entry Integration
  artifact "devpod.desktop",
           target: "#{Dir.home}/.local/share/applications/devpod.desktop"
  artifact "devpod.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod.png"

  preflight do
    # Ensure directories exist
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    # Make binaries executable before symlinking
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/dev-pod-desktop"
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/devpod-cli"

    # Copy icon from extracted archive
    icon_source = "#{staged_path}/usr/share/icons/hicolor/128x128/apps/dev-pod-desktop.png"
    if File.exist?(icon_source)
      FileUtils.cp icon_source, "#{staged_path}/devpod.png"
    else
      FileUtils.touch "#{staged_path}/devpod.png"
    end

    # Generate .desktop file pointing to HOMEBREW_PREFIX/bin symlink
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
      Keywords=devpod;loft;development;
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

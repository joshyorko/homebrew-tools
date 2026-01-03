cask "devpod-linux" do
  version "0.7.0-alpha.34"
  sha256 "27d0a51edef767962c9450516287a5484209881d495c0a3d34bb838fa15d36be"

  url "https://github.com/loft-sh/devpod/releases/download/v#{version}/DevPod_linux_amd64.AppImage",
      verified: "github.com/loft-sh/devpod/"
  name "DevPod"
  desc "UI to create reproducible developer environments based on a devcontainer.json"
  homepage "https://devpod.sh/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # AppImage runs directly - self-contained with all dependencies
  binary "DevPod_linux_amd64.AppImage", target: "devpod-desktop"

  # CLI from extracted AppImage (extraction happens in preflight)
  binary "squashfs-root/usr/bin/devpod-cli", target: "devpod"

  # Desktop Entry Integration
  artifact "devpod.desktop",
           target: "#{Dir.home}/.local/share/applications/devpod.desktop"
  artifact "devpod.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    # Make AppImage executable
    FileUtils.chmod "+x", "#{staged_path}/DevPod_linux_amd64.AppImage"

    # Extract AppImage to get icon and CLI
    system "#{staged_path}/DevPod_linux_amd64.AppImage", "--appimage-extract", chdir: staged_path

    # Copy icon from extracted AppImage (use root-level icon for best quality)
    icon_source = "#{staged_path}/squashfs-root/dev-pod-desktop.png"
    icon_fallback = "#{staged_path}/squashfs-root/usr/share/icons/hicolor/128x128/apps/dev-pod-desktop.png"
    if File.exist?(icon_source)
      FileUtils.cp icon_source, "#{staged_path}/devpod.png"
    elsif File.exist?(icon_fallback)
      FileUtils.cp icon_fallback, "#{staged_path}/devpod.png"
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

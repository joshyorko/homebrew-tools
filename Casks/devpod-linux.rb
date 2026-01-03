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

  # Link CLI to path
  binary "#{staged_path}/usr/bin/devpod-cli", target: "devpod"
  
  # Desktop Entry Integration
  artifact "devpod.desktop",
           target: "#{Dir.home}/.local/share/applications/devpod.desktop"
  artifact "devpod.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod.png"

  preflight do
    # Ensure directories exist
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    # Copy icon from extracted archive (path found via tar -tf inspection)
    icon_source = "#{staged_path}/usr/share/icons/hicolor/128x128/apps/dev-pod-desktop.png"
    if File.exist?(icon_source)
      FileUtils.cp icon_source, "#{staged_path}/devpod.png"
    else
      # Fallback: Create placeholder if icon path changes in future releases
      FileUtils.touch "#{staged_path}/devpod.png"
    end

    # Generate .desktop file
    # Note: official one in archive is generic, we generate a better one pointing to Homebrew path
    File.write("#{staged_path}/devpod.desktop", <<~EOS)
      [Desktop Entry]
      Name=DevPod
      Comment=Spin up dev environments in any cloud
      GenericName=Development Environment
      Exec=#{staged_path}/usr/bin/dev-pod-desktop %U
      Icon=#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod.png
      Type=Application
      StartupNotify=true
      StartupWMClass=dev-pod-desktop
      Categories=Development;IDE;
      Keywords=devpod;loft;development;
      MimeType=x-scheme-handler/devpod;
    EOS
    
    # Structure in tarball is flat usr/bin/dev-pod-desktop, needs to be executable
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/dev-pod-desktop"
    FileUtils.chmod "+x", "#{staged_path}/usr/bin/devpod-cli"
  end

  postflight do
    # Update icon cache
    system_command "/usr/bin/xdg-icon-resource",
                   args: ["forceupdate"],
                   must_succeed: false
  end

  zap trash: [
    "~/.devpod",
    "~/.config/devpod",
  ]
end

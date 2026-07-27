cask "devsy-desktop" do
  arch intel: "x86_64"
  os linux: "linux"

  version "1.10.0"
  sha256 x86_64_linux: "ea41fc1e6d24ea4b1ccc4e8e6e677a6c4722908bedc81c8872353e9d85b2fce8"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-desktop-1.10.0/Devsy_linux_x86_64.AppImage"
  name "Devsy"
  desc "Desktop interface for the Devsy development environment platform"
  homepage "https://devsy.sh/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on arch: :x86_64

  container type: :naked

  binary "devsy-desktop-wrapper", target: "devsy-desktop"
  artifact "devsy-desktop.desktop",
           target: "#{Dir.home}/.local/share/applications/devsy-desktop.desktop"
  artifact "devsy-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    appimage = "#{staged_path}/Devsy_linux_#{arch}.AppImage"
    system "chmod", "+x", appimage
    system appimage, "--appimage-extract", chdir: staged_path, out: File::NULL

    desktop_source = "#{staged_path}/squashfs-root/devsy-desktop.desktop"
    raise "No desktop entry found in extracted Devsy AppImage" unless File.file?(desktop_source)

    desktop_contents = File.read(desktop_source)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/devsy-desktop %U")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png"
    )
    File.write("#{staged_path}/devsy-desktop.desktop", desktop_contents)

    icon_source = "#{staged_path}/squashfs-root/usr/share/icons/hicolor/128x128/apps/devsy-desktop.png"
    raise "No 128x128 icon found in extracted Devsy AppImage" unless File.file?(icon_source)

    FileUtils.cp(icon_source, "#{staged_path}/devsy-desktop.png")

    wrapper = "#{staged_path}/devsy-desktop-wrapper"
    File.write(wrapper, <<~SH)
      #!/bin/bash
      exec "#{appimage}" "$@"
    SH
    FileUtils.chmod 0755, wrapper
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    desktop_id = "devsy-desktop.desktop"
    xdg_mime = ["/usr/bin/xdg-mime", "/bin/xdg-mime", "#{HOMEBREW_PREFIX}/bin/xdg-mime"]
      .find { |candidate| File.executable?(candidate) }
    update_desktop_database = [
      "/usr/bin/update-desktop-database",
      "/bin/update-desktop-database",
      "#{HOMEBREW_PREFIX}/bin/update-desktop-database",
    ].find { |candidate| File.executable?(candidate) }

    system xdg_mime, "default", desktop_id, "x-scheme-handler/devsy" if xdg_mime
    system update_desktop_database, applications_dir if update_desktop_database
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/devsy-desktop.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png",
  ]

  caveats <<~EOS
    Launch the desktop app with:
      devsy-desktop

    The AppImage contains an internal Devsy CLI used by the desktop app, but
    this cask does not expose it on PATH. Install the independently versioned
    CLI formula when you want the devsy command:
      brew install joshyorko/tools/devsy
  EOS
end

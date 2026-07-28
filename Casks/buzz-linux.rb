cask "buzz-linux" do
  arch intel: "x86_64"
  os linux: "linux"

  version "0.5.0,1"
  sha256 x86_64_linux: "62d8dbba3a58b5b4ea2d7edb166158a3aa374e49aa0212c378a1d886877a775f"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/buzz-linux-0.5.0-1/buzz-linux-0.5.0-1-x86_64.AppImage"
  name "Buzz"
  desc "Portable Linux desktop client for the Buzz collaboration platform"
  homepage "https://github.com/block/buzz"

  livecheck do
    skip "Updated by the tap's release workflow."
  end

  depends_on arch: :x86_64
  container type: :naked

  binary "buzz-linux-wrapper", target: "buzz"
  artifact "buzz.desktop",
           target: "#{Dir.home}/.local/share/applications/buzz.desktop"
  artifact "buzz.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/buzz.png"

  preflight do
    appimage = "#{staged_path}/buzz-linux-#{version.csv.first}-#{version.csv.second}-#{arch}.AppImage"
    FileUtils.chmod 0755, appimage
    system appimage, "--appimage-extract", chdir: staged_path, out: File::NULL

    desktop_source = "#{staged_path}/squashfs-root/usr/share/applications/Buzz.desktop"
    icon_source = "#{staged_path}/squashfs-root/usr/share/icons/hicolor/128x128/apps/buzz-desktop.png"
    raise "Buzz desktop entry is missing" unless File.file?(desktop_source)
    raise "Buzz icon is missing" unless File.file?(icon_source)

    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    desktop_contents = File.read(desktop_source)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/buzz %U")
    desktop_contents.gsub!(/^Icon=.*/, "Icon=#{Dir.home}/.local/share/icons/hicolor/128x128/apps/buzz.png")
    File.write("#{staged_path}/buzz.desktop", desktop_contents)
    FileUtils.cp(icon_source, "#{staged_path}/buzz.png")

    wrapper = "#{staged_path}/buzz-linux-wrapper"
    File.write(wrapper, <<~SH)
      #!/bin/bash
      exec "#{appimage}" "$@"
    SH
    FileUtils.chmod 0755, wrapper
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    xdg_mime = ["/usr/bin/xdg-mime", "/bin/xdg-mime", "#{HOMEBREW_PREFIX}/bin/xdg-mime"]
               .find { |candidate| File.executable?(candidate) }
    update_desktop_database = [
      "/usr/bin/update-desktop-database",
      "/bin/update-desktop-database",
      "#{HOMEBREW_PREFIX}/bin/update-desktop-database",
    ].find { |candidate| File.executable?(candidate) }

    system xdg_mime, "default", "buzz.desktop", "x-scheme-handler/buzz" if xdg_mime
    system update_desktop_database, applications_dir if update_desktop_database
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/buzz.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/buzz.png",
  ]

  caveats <<~EOS
    Launch Buzz from the desktop menu or run:
      buzz

    This x86_64 glibc build uses the host graphics, WebKitGTK, GStreamer, and
    font libraries. It is intended for current Fedora, Arch, and Ubuntu-family
    systems running Wayland or X11.
  EOS
end

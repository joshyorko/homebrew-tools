cask "codex-desktop" do
  version "dmg.20260514200933.de0f41408b3a"
  sha256 "47dfd0a866bde6e5b7d77ee37185b55cb00e1e826bc88518005e3137196fde42"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-desktop-linux-dmg.20260514200933.de0f41408b3a/codex-desktop-linux-dmg.20260514200933.de0f41408b3a.tar.gz"
  name "Codex Desktop"
  desc "Linux runtime for a DMG-converted Codex Desktop app"
  homepage "https://github.com/joshyorko/homebrew-tools"

  livecheck do
    skip "Built from the official upstream Codex.dmg input via Dagger."
  end

  depends_on cask: "codex"
  depends_on formula: "desktop-file-utils"

  binary "bin/codex-desktop", target: "codex-desktop"
  artifact "share/applications/codex-desktop.desktop",
           target: "#{Dir.home}/.local/share/applications/codex-desktop.desktop"
  artifact "share/icons/hicolor/512x512/apps/codex-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png"
  artifact "share/icons/hicolor/256x256/apps/codex-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/512x512/apps"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/256x256/apps"

    desktop_file = "#{staged_path}/share/applications/codex-desktop.desktop"
    desktop_contents = File.read(desktop_file)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/codex-desktop desktop %U")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png"
    )
    desktop_contents.gsub!(/^StartupWMClass=.*/, "StartupWMClass=Codex")
    desktop_contents << "StartupWMClass=Codex\n" unless desktop_contents.match?(/^StartupWMClass=/)
    desktop_contents.gsub!(/^X-GNOME-WMClass=.*/, "X-GNOME-WMClass=Codex")
    desktop_contents << "X-GNOME-WMClass=Codex\n" unless desktop_contents.match?(/^X-GNOME-WMClass=/)
    mime_type = "MimeType=x-scheme-handler/codex;x-scheme-handler/codex-browser-sidebar;"
    if desktop_contents.match?(/^MimeType=/)
      desktop_contents.gsub!(/^MimeType=.*/, mime_type)
    else
      desktop_contents << "#{mime_type}\n"
    end
    File.write(desktop_file, desktop_contents)
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    desktop_id = "codex-desktop.desktop"
    desktop_target = "#{applications_dir}/#{desktop_id}"
    xdg_mime = [
      "/usr/bin/xdg-mime",
      "/bin/xdg-mime",
      "#{HOMEBREW_PREFIX}/bin/xdg-mime",
    ].find { |path| File.executable?(path) }
    update_desktop_database = [
      "/usr/bin/update-desktop-database",
      "/bin/update-desktop-database",
      "#{HOMEBREW_PREFIX}/bin/update-desktop-database",
    ].find { |path| File.executable?(path) }

    FileUtils.chmod 0755, desktop_target if File.exist?(desktop_target)
    if xdg_mime
      system xdg_mime, "default", desktop_id, "x-scheme-handler/codex"
      system xdg_mime, "default", desktop_id, "x-scheme-handler/codex-browser-sidebar"
    end
    system update_desktop_database, applications_dir if update_desktop_database
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/codex-desktop.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png",
    "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png",
  ]

  caveats <<~EOS
    Launch from your app grid as Codex Desktop, or run:
      codex-desktop

    Logs and diagnostics:
      codex-desktop logs
      codex-desktop logs --follow
      codex-desktop doctor

    Desktop launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/codex-desktop.desktop
  EOS
end

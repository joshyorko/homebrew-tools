cask "vscode-insiders-linux" do
  arch intel: "x64"
  os linux: "linux"

  version "1.120.0,1778260944.el8,3b8129f1d0e4"
  sha256 x86_64_linux: "35f1d6337f744a76adcab23002266c9ccdb5897bd26414d5b4febcc61291e54b"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/vscode-insiders-linux-1.120.0-1778260944.el8-3b8129f1d0e4/vscode-insiders-linux-1.120.0-1778260944.el8-3b8129f1d0e4.tar.gz"
  name "Visual Studio Code - Insiders"
  desc "Insiders build of Visual Studio Code packaged for Linux Homebrew"
  homepage "https://code.visualstudio.com/insiders/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  binary "usr/share/code-insiders/bin/code-insiders", target: "code-insiders"
  binary "usr/share/code-insiders/bin/code-tunnel-insiders", target: "code-tunnel-insiders"
  artifact "usr/share/applications/code-insiders.desktop",
           target: "#{Dir.home}/.local/share/applications/code-insiders.desktop"
  artifact "usr/share/applications/code-insiders-url-handler.desktop",
           target: "#{Dir.home}/.local/share/applications/code-insiders-url-handler.desktop"
  artifact "usr/share/pixmaps/vscode-insiders.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png"
  artifact "usr/share/mime/packages/code-insiders-workspace.xml",
           target: "#{Dir.home}/.local/share/mime/packages/code-insiders-workspace.xml"

  preflight do
    legacy_paths = [
      "#{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop",
      "#{Dir.home}/.local/share/applications/vscode-insiders-linux-url-handler.desktop",
      "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png",
    ]

    legacy_paths.each do |path|
      FileUtils.rm_f(path)
    end

    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/512x512/apps"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/mime/packages"

    desktop_file = "#{staged_path}/usr/share/applications/code-insiders.desktop"
    desktop_contents = File.read(desktop_file)
    raise "missing upstream Exec in #{desktop_file}" unless desktop_contents.gsub!(
      %r{^Exec=/usr/share/code-insiders/code-insiders %F$},
      "Exec=/usr/bin/env CHROME_DESKTOP=code-insiders.desktop #{HOMEBREW_PREFIX}/bin/code-insiders %F",
    )
    raise "missing new-window action Exec in #{desktop_file}" unless desktop_contents.gsub!(
      %r{^Exec=/usr/share/code-insiders/code-insiders --new-window %F$},
      "Exec=/usr/bin/env CHROME_DESKTOP=code-insiders.desktop #{HOMEBREW_PREFIX}/bin/code-insiders --new-window %F",
    )
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png",
    )
    File.write(desktop_file, desktop_contents)

    url_handler_file = "#{staged_path}/usr/share/applications/code-insiders-url-handler.desktop"
    url_handler_contents = File.read(url_handler_file)
    raise "missing URL handler Exec in #{url_handler_file}" unless url_handler_contents.gsub!(
      %r{^Exec=/usr/share/code-insiders/code-insiders --open-url %U$},
      "Exec=/usr/bin/env CHROME_DESKTOP=code-insiders.desktop #{HOMEBREW_PREFIX}/bin/code-insiders --open-url %U",
    )
    url_handler_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png",
    )
    File.write(url_handler_file, url_handler_contents)

    package_json_file = "#{staged_path}/usr/share/code-insiders/resources/app/package.json"
    package_json_contents = File.read(package_json_file)
    raise "missing desktopName in #{package_json_file}" unless package_json_contents.gsub!(
      /"desktopName"\s*:\s*"[^"]+"/,
      '"desktopName": "code-insiders.desktop"',
    )
    File.write(package_json_file, package_json_contents)
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    mime_dir = "#{Dir.home}/.local/share/mime"
    desktop_id = "code-insiders-url-handler.desktop"

    xdg_mime = ["/usr/bin/xdg-mime", "/bin/xdg-mime", "#{HOMEBREW_PREFIX}/bin/xdg-mime"].find do |candidate|
      File.executable?(candidate)
    end
    xdg_settings = ["/usr/bin/xdg-settings", "/bin/xdg-settings", "#{HOMEBREW_PREFIX}/bin/xdg-settings"].find do |candidate|
      File.executable?(candidate)
    end
    update_desktop_database = [
      "/usr/bin/update-desktop-database",
      "/bin/update-desktop-database",
      "#{HOMEBREW_PREFIX}/bin/update-desktop-database",
    ].find { |candidate| File.executable?(candidate) }
    update_mime_database = [
      "/usr/bin/update-mime-database",
      "/bin/update-mime-database",
      "#{HOMEBREW_PREFIX}/bin/update-mime-database",
    ].find { |candidate| File.executable?(candidate) }

    system xdg_mime, "default", desktop_id, "x-scheme-handler/vscode-insiders" if xdg_mime
    if xdg_settings
      system xdg_settings, "set", "default-url-scheme-handler", "vscode-insiders", desktop_id
    end
    system update_desktop_database, applications_dir if update_desktop_database
    system update_mime_database, mime_dir if update_mime_database
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/code-insiders.desktop",
    "#{Dir.home}/.local/share/applications/code-insiders-url-handler.desktop",
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop",
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux-url-handler.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png",
    "#{Dir.home}/.local/share/mime/packages/code-insiders-workspace.xml",
  ]

  caveats <<~EOS
    Launch the editor with:
      code-insiders

    Tunnel CLI is also available:
      code-tunnel-insiders

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/code-insiders.desktop

    URL handler installed for vscode-insiders:// links:
      #{Dir.home}/.local/share/applications/code-insiders-url-handler.desktop

    Workspace MIME definition installed at:
      #{Dir.home}/.local/share/mime/packages/code-insiders-workspace.xml

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end

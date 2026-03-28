cask "vscode-insiders-linux" do
  arch intel: "x64"
  os linux: "linux"

  version "1.114.0,1774631137,00515ed0a37c"
  sha256 x86_64_linux: "363e032a09b75be0a3bb800729e9d613461ee156780f8c9c76237aedd77f32b4"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/vscode-insiders-linux-1.114.0-1774631137-00515ed0a37c/vscode-insiders-linux-1.114.0-1774631137-00515ed0a37c.tar.gz"
  name "Visual Studio Code - Insiders"
  desc "Insiders build of Visual Studio Code packaged for Linux Homebrew"
  homepage "https://code.visualstudio.com/insiders/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  binary "VSCode-linux-x64/bin/code-insiders", target: "code-insiders"
  binary "VSCode-linux-x64/bin/code-tunnel-insiders", target: "code-tunnel-insiders"
  artifact "vscode-insiders-linux.desktop",
           target: "#{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop"
  artifact "vscode-insiders-linux-url-handler.desktop",
           target: "#{Dir.home}/.local/share/applications/vscode-insiders-linux-url-handler.desktop"
  artifact "VSCode-linux-x64/resources/app/resources/linux/code.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/512x512/apps"

    desktop_file = "#{staged_path}/vscode-insiders-linux.desktop"
    File.write(desktop_file, <<~EOS)
      [Desktop Entry]
      Version=1.0
      Type=Application
      Name=Visual Studio Code - Insiders
      GenericName=Text Editor
      Comment=Code Editing. Redefined.
      Exec=/usr/bin/env CHROME_DESKTOP=vscode-insiders-linux.desktop #{HOMEBREW_PREFIX}/bin/code-insiders %F
      Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png
      Terminal=false
      StartupNotify=false
      StartupWMClass=Code - Insiders
      Categories=TextEditor;Development;IDE;
      MimeType=text/plain;inode/directory;
      Keywords=vscode;code;editor;insiders;
      Actions=new-empty-window;

      [Desktop Action new-empty-window]
      Name=New Empty Window
      Exec=/usr/bin/env CHROME_DESKTOP=vscode-insiders-linux.desktop #{HOMEBREW_PREFIX}/bin/code-insiders --new-window %F
      Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png
    EOS

    url_handler_file = "#{staged_path}/vscode-insiders-linux-url-handler.desktop"
    File.write(url_handler_file, <<~EOS)
      [Desktop Entry]
      Version=1.0
      Type=Application
      Name=Visual Studio Code - Insiders - URL Handler
      GenericName=Text Editor
      Comment=Code Editing. Redefined.
      Exec=/usr/bin/env CHROME_DESKTOP=vscode-insiders-linux.desktop #{HOMEBREW_PREFIX}/bin/code-insiders --open-url %U
      Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png
      NoDisplay=true
      StartupNotify=true
      StartupWMClass=Code - Insiders
      Categories=Utility;TextEditor;Development;IDE;
      MimeType=x-scheme-handler/vscode-insiders;
      Keywords=vscode;code;editor;insiders;
    EOS
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    desktop_id = "vscode-insiders-linux-url-handler.desktop"

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

    system xdg_mime, "default", desktop_id, "x-scheme-handler/vscode-insiders" if xdg_mime
    if xdg_settings
      system xdg_settings, "set", "default-url-scheme-handler", "vscode-insiders", desktop_id
    end
    system update_desktop_database, applications_dir if update_desktop_database
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop",
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux-url-handler.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png",
  ]

  caveats <<~EOS
    Launch the editor with:
      code-insiders

    Tunnel CLI is also available:
      code-tunnel-insiders

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop

    URL handler installed for vscode-insiders:// links:
      #{Dir.home}/.local/share/applications/vscode-insiders-linux-url-handler.desktop

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end

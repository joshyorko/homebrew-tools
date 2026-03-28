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
      MimeType=text/plain;inode/directory;x-scheme-handler/vscode-insiders;
      Keywords=vscode;code;editor;insiders;
      Actions=new-empty-window;

      [Desktop Action new-empty-window]
      Name=New Empty Window
      Exec=/usr/bin/env CHROME_DESKTOP=vscode-insiders-linux.desktop #{HOMEBREW_PREFIX}/bin/code-insiders --new-window %F
      Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png
    EOS
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png",
  ]

  caveats <<~EOS
    Launch the editor with:
      code-insiders

    Tunnel CLI is also available:
      code-tunnel-insiders

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end

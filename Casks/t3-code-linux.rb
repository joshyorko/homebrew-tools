cask "t3-code-linux" do
  arch intel: "x86_64"
  os linux: "linux"

  version "0.0.9"
  sha256 x86_64_linux: "8dd2e6ae239bf56b2eb0e20268f85e8710f1e2002cc4755bf2624f2248054d98"

  url "https://github.com/pingdotgg/t3code/releases/download/v#{version}/T3-Code-#{version}-#{arch}.AppImage",
      verified: "github.com/pingdotgg/t3code/"
  name "T3 Code"
  desc "Minimal GUI for AI code agents"
  homepage "https://t3.codes/"

  livecheck do
    url :url
    strategy :github_latest
  end

  container type: :naked

  binary "t3-code-linux-wrapper", target: "t3-code-linux"
  artifact "t3-code-linux.desktop",
           target: "#{Dir.home}/.local/share/applications/t3-code-linux.desktop"
  artifact "t3-code-linux.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/1024x1024/apps/t3-code-linux.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/1024x1024/apps"

    appimage = "#{staged_path}/T3-Code-#{version}-#{arch}.AppImage"
    system "chmod", "+x", appimage
    system appimage, "--appimage-extract", chdir: staged_path, out: File::NULL

    desktop_file = "#{staged_path}/t3-code-linux.desktop"
    desktop_contents = File.read("#{staged_path}/squashfs-root/t3-code-desktop.desktop")
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/t3-code-linux %U")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/1024x1024/apps/t3-code-linux.png"
    )
    File.write(desktop_file, desktop_contents)

    FileUtils.cp(
      "#{staged_path}/squashfs-root/usr/share/icons/hicolor/1024x1024/apps/t3-code-desktop.png",
      "#{staged_path}/t3-code-linux.png"
    )

    wrapper = "#{staged_path}/t3-code-linux-wrapper"
    File.write(wrapper, <<~SH)
      #!/bin/bash
      exec "#{staged_path}/T3-Code-#{version}-#{arch}.AppImage" --no-sandbox "$@"
    SH
    system "chmod", "+x", wrapper
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/t3-code-linux.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/1024x1024/apps/t3-code-linux.png",
  ]

  caveats <<~EOS
    Launch the app with:
      t3-code-linux

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/t3-code-linux.desktop

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end

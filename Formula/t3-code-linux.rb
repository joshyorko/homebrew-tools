class T3CodeLinux < Formula
  desc "Linux AppImage packaging for T3 Code desktop"
  homepage "https://t3.codes/"
  version "0.0.9"
  url "https://github.com/pingdotgg/t3code/releases/download/v#{version}/T3-Code-#{version}-x86_64.AppImage"
  sha256 "8dd2e6ae239bf56b2eb0e20268f85e8710f1e2002cc4755bf2624f2248054d98"
  license "MIT"

  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on :linux

  def install
    odie "t3-code-linux is currently x86_64-only" unless Hardware::CPU.intel?

    chmod 0755, cached_download
    system cached_download, "--appimage-extract"

    libexec.install cached_download => "t3-code.AppImage"

    (bin/"t3-code-linux").write <<~SH
      #!/bin/bash
      exec "#{libexec}/t3-code.AppImage" --no-sandbox "$@"
    SH
    chmod 0755, bin/"t3-code-linux"

    (share/"applications").mkpath
    (share/"icons/hicolor/1024x1024/apps").mkpath

    cp buildpath/"squashfs-root/usr/share/icons/hicolor/1024x1024/apps/t3-code-desktop.png",
       share/"icons/hicolor/1024x1024/apps/t3-code-linux.png"

    desktop_entry = (buildpath/"squashfs-root/t3-code-desktop.desktop").read
    desktop_entry.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/t3-code-linux %U")
    desktop_entry.gsub!(/^Icon=.*/, "Icon=#{HOMEBREW_PREFIX}/share/icons/hicolor/1024x1024/apps/t3-code-linux.png")
    (share/"applications/t3-code-linux.desktop").write(desktop_entry)
  end

  def caveats
    <<~EOS
      Launch the app with:
        t3-code-linux

      A desktop entry was installed to:
        #{HOMEBREW_PREFIX}/share/applications/t3-code-linux.desktop

      If your desktop launcher doesn't appear automatically, add this to your shell profile:
        export XDG_DATA_DIRS="#{HOMEBREW_PREFIX}/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
    EOS
  end

  test do
    assert_path_exists libexec/"t3-code.AppImage"
    assert_path_exists bin/"t3-code-linux"
    assert_path_exists share/"applications/t3-code-linux.desktop"
    assert_path_exists share/"icons/hicolor/1024x1024/apps/t3-code-linux.png"

    desktop_entry = (share/"applications/t3-code-linux.desktop").read
    assert_match "#{HOMEBREW_PREFIX}/bin/t3-code-linux %U", desktop_entry
    assert_match version.to_s, desktop_entry
  end
end

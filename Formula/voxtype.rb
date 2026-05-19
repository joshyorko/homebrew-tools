class Voxtype < Formula
  desc "Push-to-talk voice-to-text for Linux desktops"
  homepage "https://github.com/peteonrails/voxtype"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/voxtype-0.7.3/voxtype-0.7.3-homebrew-x86_64-linux.tar.gz"
  version "0.7.3"
  sha256 "d5e8663ca8025c0ad9a59850eb8923568ef246173ed8826f0f06d75a0d11c466"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on arch: :x86_64
  depends_on :linux

  def install
    libexec.install "libexec/voxtype"
    pkgshare.install "share/voxtype/default.toml"

    bash_completion.install "completions/bash/voxtype" if File.exist?("completions/bash/voxtype")
    fish_completion.install "completions/fish/voxtype.fish" if File.exist?("completions/fish/voxtype.fish")
    zsh_completion.install "completions/zsh/_voxtype" if File.exist?("completions/zsh/_voxtype")

    man1.install Dir["man/man1/*.1"] if Dir.exist?("man/man1")
    doc.install "README.md", "LICENSE"

    (bin/"voxtype").write <<~SH
      #!/bin/bash
      exec "#{libexec}/voxtype" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/voxtype --version")
    assert_match version.to_s, output
    assert_path_exists pkgshare/"default.toml"
  end

  def caveats
    <<~EOS
      First-run setup:
        voxtype setup --download
        voxtype setup systemd

      Runtime backends such as `wtype`, `wl-clipboard`, `dotool`, or `ydotool` still
      come from your host OS package manager. `eitype` for GNOME/KDE Wayland can be
      installed from this tap with `brew install eitype`. On Bluefin and other
      immutable Linux systems, install the host-managed tools with `rpm-ostree`,
      `dnf`, or your preferred host package flow.
    EOS
  end
end

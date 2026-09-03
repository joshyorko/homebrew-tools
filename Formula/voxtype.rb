class Voxtype < Formula
  desc "Push-to-talk voice-to-text for Linux desktops"
  homepage "https://github.com/peteonrails/voxtype"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/voxtype-1.0.0-vulkan.1/voxtype-1.0.0-homebrew-x86_64-linux.tar.gz"
  version "1.0.0"
  revision 1
  sha256 "6fe0365ef59638e7de154727ec8eebce3967b1e84f1577cca53aa6262ebba247"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on arch: :x86_64
  depends_on :linux

  def install
    libexec.install Dir["libexec/*"]
    pkgshare.install "share/voxtype/default.toml"

    bash_completion.install "completions/bash/voxtype" if File.exist?("completions/bash/voxtype")
    fish_completion.install "completions/fish/voxtype.fish" if File.exist?("completions/fish/voxtype.fish")
    zsh_completion.install "completions/zsh/_voxtype" if File.exist?("completions/zsh/_voxtype")

    man1.install Dir["man/man1/*.1"] if Dir.exist?("man/man1")
    doc.install "README.md", "LICENSE"

    %w[voxtype voxtype-osd voxtype-osd-gtk4 voxtype-audio-bridge].each do |executable|
      next unless (libexec/executable).exist?

      (bin/executable).write <<~SH
        #!/bin/bash
        exec "#{libexec}/#{executable}" "$@"
      SH
    end
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

      The local Dakota installer uses the upstream Vulkan build and Whisper
      large-v3-turbo when an NVIDIA Vulkan device is available. `eitype` for
      GNOME/KDE Wayland can be installed from this tap with `brew install eitype`.
    EOS
  end
end

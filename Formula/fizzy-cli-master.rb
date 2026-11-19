class FizzyCliMaster < Formula
  desc "Fizzy CLI built from basecamp/fizzy-cli master"
  homepage "https://github.com/basecamp/fizzy-cli"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-cli-master-master.b4a4086f1037/fizzy-cli-master-master.b4a4086f1037-homebrew-x86_64-linux.tar.gz"
  version "master.b4a4086f1037"
  sha256 "70f1a6219885f6e85d9bcc64301a6619e9f47e4c69106c150a58bcba0eea3f90"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on arch: :x86_64
  depends_on :linux

  conflicts_with "fizzy", because: "both install a fizzy executable"

  def install
    libexec.install "libexec/fizzy"

    bash_completion.install "completions/bash/fizzy" if File.exist?("completions/bash/fizzy")
    fish_completion.install "completions/fish/fizzy.fish" if File.exist?("completions/fish/fizzy.fish")
    zsh_completion.install "completions/zsh/_fizzy" if File.exist?("completions/zsh/_fizzy")

    doc.install "README.md", "LICENSE"

    (bin/"fizzy").write <<~SH
      #!/bin/bash
      exec "#{libexec}/fizzy" "$@"
    SH
  end

  def caveats
    <<~EOS
      This tap's Fizzy package tracks a pinned snapshot of upstream `master`, not the
      latest upstream GitHub release.

      The formula name is unique (`fizzy-cli-master`), but the installed executable is
      still `fizzy` so existing wrappers can keep working.

      Homebrew prevents silent collisions with any future upstream `fizzy` formula by
      treating them as conflicting packages.
    EOS
  end

  test do
    output = shell_output("#{bin}/fizzy --version")
    assert_match version.to_s, output
  end
end

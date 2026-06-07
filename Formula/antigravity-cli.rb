class AntigravityCli < Formula
  desc "Google Antigravity CLI"
  homepage "https://antigravity.google/"
  url "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.0.6-6458082025406464/linux-x64/cli_linux_x64.tar.gz"
  version "1.0.6"
  sha256 "3eae552781d3054b782142e3cfe7be73e3bd068c736a432ca6f1adaa40f19e07"
  license :cannot_represent

  livecheck do
    skip "Google publishes this CLI through a platform manifest; update manually after verifying the checksum."
  end

  depends_on arch: :x86_64
  depends_on :linux

  def install
    libexec.install "antigravity"

    (bin/"agy").write <<~SH
      #!/bin/bash
      exec "#{libexec}/antigravity" "$@"
    SH
  end

  def caveats
    <<~EOS
      This formula packages Google's closed-source Antigravity CLI binary for
      Linux x86_64. It does not run the upstream installer during `brew install`.

      First-run shell setup, if wanted:
        agy install

      Upstream installer reference:
        curl -fsSL https://antigravity.google/cli/install.sh | bash
    EOS
  end

  test do
    output = shell_output("#{bin}/agy --version")
    assert_match version.to_s, output
  end
end

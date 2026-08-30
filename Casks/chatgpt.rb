# frozen_string_literal: true

cask "chatgpt" do
  arch arm: "aarch64", intel: "x86_64"
  deb_arch = on_arch_conditional arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.825.51511"
  sha256 arm:          "45f225f9cd6b3b6bbfda8c3555fcdc03d9cae0421c2323a9b7f2db61bbb7c4f9",
       intel:        "44e19ee796d788bffd741acb86a87be2f295d74fc4847132e7482bf04972c58d",
       arm64_linux:  "45f225f9cd6b3b6bbfda8c3555fcdc03d9cae0421c2323a9b7f2db61bbb7c4f9",
       x86_64_linux: "44e19ee796d788bffd741acb86a87be2f295d74fc4847132e7482bf04972c58d"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/chatgpt-#{version}/chatgpt-#{version}-1.#{arch}.rpm"
  name "ChatGPT"
  desc "OpenAI's official ChatGPT desktop app"
  homepage "https://chatgpt.com/"

  livecheck do
    url "https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-#{deb_arch}/Packages"
    regex(/^Version:\s*(\d+(?:\.\d+)+)$/i)
  end

  auto_updates true
  depends_on formula: "cpio"
  depends_on formula: "rpm2cpio"

  binary "usr/lib/chatgpt/codex-launcher", target: "chatgpt"
  artifact "usr/share/applications/chatgpt.desktop",
           target: "#{Dir.home}/.local/share/applications/chatgpt.desktop"
  artifact "usr/share/pixmaps/chatgpt.png",
           target: "#{Dir.home}/.local/share/pixmaps/chatgpt.png"

  preflight do
    rpm2cpio = Formula["rpm2cpio"].bin/"rpm2cpio"
    cpio = Formula["cpio"].bin/"cpio"
    rpm_path = staged_path/"chatgpt-#{version}-1.#{arch}.rpm"
    system "sh", "-c", "'#{rpm2cpio}' '#{rpm_path}' | '#{cpio}' -idm --quiet", chdir: staged_path
    FileUtils.rm rpm_path

    desktop_file = staged_path/"usr/share/applications/chatgpt.desktop"
    content = File.read(desktop_file)
    content.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/chatgpt %U")
    content.gsub!(/^Icon=.*/, "Icon=#{Dir.home}/.local/share/pixmaps/chatgpt.png")
    File.write(desktop_file, content)
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/chatgpt.desktop",
    "#{Dir.home}/.local/share/pixmaps/chatgpt.png",
  ]

  caveats <<~EOS
    Launch ChatGPT with:
      chatgpt

    ChatGPT and Codex user data is left in place when this cask is removed.
  EOS
end

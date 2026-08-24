# frozen_string_literal: true

cask "chatgpt" do
  arch arm: "aarch64", intel: "x86_64"
  deb_arch = on_arch_conditional arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.818.61809"
  sha256 arm:          "46aaa7fbba080c79e13d53eb60094f38ad0ff0988404279e1b3d1b0faa85d9b6",
       intel:        "b2439695f738a06a0b36bcc33868f2824a6df8473fa1160baa649a84004f31d6",
       arm64_linux:  "46aaa7fbba080c79e13d53eb60094f38ad0ff0988404279e1b3d1b0faa85d9b6",
       x86_64_linux: "b2439695f738a06a0b36bcc33868f2824a6df8473fa1160baa649a84004f31d6"

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

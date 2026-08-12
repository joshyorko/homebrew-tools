# frozen_string_literal: true

cask "chatgpt" do
  arch arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.803.81509"
  sha256 arm64_linux:  "f38fcc194eca9ab0327dc10c92340681eae77c5d75164df700384ce2adaccbc1",
         x86_64_linux: "a9bf91a368f9f7c4eea38082a9fb8fb46b8d005b719a6d7715d2e5a1982c38eb"

  url "https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_#{arch}.deb"
  name "ChatGPT"
  desc "ChatGPT Desktop for Linux from OpenAI's official package"
  homepage "https://developers.openai.com/codex/app"

  livecheck do
    skip "Updated manually after verifying OpenAI's official Linux DEB."
  end

  depends_on formula: "xz"

  binary "usr/lib/chatgpt/codex-launcher", target: "chatgpt"
  artifact "usr/share/applications/chatgpt.desktop",
           target: "#{Dir.home}/.local/share/applications/chatgpt.desktop"
  artifact "usr/share/pixmaps/chatgpt.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/chatgpt.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/512x512/apps"

    deb = Dir["#{staged_path}/chatgpt_*.deb"].first
    raise "unable to find ChatGPT .deb in #{staged_path}" if deb.blank?

    system "ar", "x", deb, chdir: staged_path
    data_archive = Dir["#{staged_path}/data.tar.*"].first
    raise "unable to find data archive in #{deb}" if data_archive.blank?

    case data_archive
    when /\.tar\.gz$/
      system "tar", "-xzf", data_archive, "-C", staged_path
    when /\.tar\.xz$/
      system "tar", "--use-compress-program=#{HOMEBREW_PREFIX}/opt/xz/bin/xz", "-xf", data_archive,
             "-C", staged_path
    when /\.tar\.zst$/
      system "sh", "-c", "unzstd -c '#{data_archive}' | tar -xf - -C '#{staged_path}'"
    else
      system "tar", "-xf", data_archive, "-C", staged_path
    end

    desktop_file = "#{staged_path}/usr/share/applications/chatgpt.desktop"
    desktop_contents = File.read(desktop_file)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/chatgpt %U")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/chatgpt.png"
    )
    File.write(desktop_file, desktop_contents)
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/chatgpt.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/chatgpt.png",
  ]

  caveats <<~EOS
    Launch ChatGPT with:
      chatgpt

    ChatGPT and Codex user data is left in place when this cask is removed.
  EOS
end

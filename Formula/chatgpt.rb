require "digest"
require "fileutils"
require "tmpdir"

class Chatgpt < Formula
  PACKAGE_ARCHITECTURE = Hardware::CPU.arm? ? "arm64" : "amd64"
  PACKAGE_URL = {
    "amd64" => "https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb",
    "arm64" => "https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_arm64.deb",
  }.freeze
  PACKAGE_SHA256 = {
    "amd64" => "a9bf91a368f9f7c4eea38082a9fb8fb46b8d005b719a6d7715d2e5a1982c38eb",
    "arm64" => "f38fcc194eca9ab0327dc10c92340681eae77c5d75164df700384ce2adaccbc1",
  }.freeze

  desc "ChatGPT Desktop for Linux from OpenAI's official package"
  homepage "https://developers.openai.com/codex/app"
  version "26.803.81509"
  license :cannot_represent

  livecheck do
    skip "Updated manually after verifying OpenAI's official Linux DEB."
  end

  depends_on :linux

  on_linux do
    url PACKAGE_URL.fetch(PACKAGE_ARCHITECTURE)
    sha256 PACKAGE_SHA256.fetch(PACKAGE_ARCHITECTURE)
  end

  def install
    deb_path = Pathname(cached_download)
    verify_sha256(deb_path)

    Dir.mktmpdir("chatgpt-deb") do |dir|
      Dir.chdir(dir) do
        odie "Unable to extract ChatGPT DEB" unless system "ar", "x", deb_path.to_s
      end

      control_archive = Dir["#{dir}/control.tar.*"].first
      data_archive = Dir["#{dir}/data.tar.*"].first
      odie "ChatGPT DEB is missing its control archive" unless control_archive
      odie "ChatGPT DEB is missing its data archive" unless data_archive

      control_dir = "#{dir}/control"
      FileUtils.mkdir_p control_dir
      extract_archive(control_archive, control_dir)
      control = File.read("#{control_dir}/control")
      odie "Unexpected ChatGPT package name" unless control_field(control, "Package") == "chatgpt"
      odie "Unexpected ChatGPT package version" unless control_field(control, "Version") == version.to_s
      odie "Unexpected ChatGPT package architecture" unless control_field(control, "Architecture") == PACKAGE_ARCHITECTURE

      extract_archive(data_archive, dir)
      app_dir = Pathname(dir)/"usr/lib/chatgpt"
      desktop_source = Pathname(dir)/"usr/share/applications/chatgpt.desktop"
      icon_source = Pathname(dir)/"usr/share/pixmaps/chatgpt.png"
      odie "ChatGPT application payload is missing" unless app_dir.directory?
      odie "ChatGPT desktop entry is missing" unless desktop_source.file?
      odie "ChatGPT icon is missing" unless icon_source.file?

      libexec.install app_dir

      desktop_contents = File.read(desktop_source)
      unless desktop_contents.match?(/^Exec=.*$/) && desktop_contents.match?(/^Icon=.*$/)
        odie "ChatGPT desktop entry is missing Exec or Icon"
      end
      desktop_contents = desktop_contents.gsub(/^Exec=.*$/, "Exec=#{opt_bin}/chatgpt %U")
      desktop_contents = desktop_contents.gsub(/^Icon=.*$/, "Icon=#{opt_share}/pixmaps/chatgpt.png")

      applications_dir = share/"applications"
      pixmaps_dir = share/"pixmaps"
      applications_dir.mkpath
      pixmaps_dir.mkpath
      File.write(applications_dir/"chatgpt.desktop", desktop_contents)
      FileUtils.cp icon_source, pixmaps_dir/"chatgpt.png"
    end

    (bin/"chatgpt").write <<~SH
      #!/bin/sh
      exec "#{libexec}/chatgpt/codex-launcher" "$@"
    SH
  end

  test do
    assert_path_exists libexec/"chatgpt/ChatGPT"
    assert_path_exists libexec/"chatgpt/resources/app.asar"
    assert_predicate libexec/"chatgpt/codex-launcher", :executable?
    assert_predicate bin/"chatgpt", :executable?
    assert_path_exists share/"applications/chatgpt.desktop"
    assert_path_exists share/"pixmaps/chatgpt.png"

    desktop_contents = (share/"applications/chatgpt.desktop").read
    assert_match(/Exec=#{Regexp.escape(opt_bin.to_s)}\/chatgpt %U/, desktop_contents)
    assert_match(/Icon=#{Regexp.escape(opt_share.to_s)}\/pixmaps\/chatgpt.png/, desktop_contents)
    assert_match(/#{Regexp.escape(libexec.to_s)}\/chatgpt\/codex-launcher/, (bin/"chatgpt").read)
  end

  def caveats
    <<~EOS
      This formula downloads and extracts OpenAI's official Linux DEB locally.
      It does not run the Debian maintainer scripts, add an APT repository, or
      change AppArmor configuration.

      Launch ChatGPT with:
        chatgpt

      Homebrew owns only the application and desktop files under its prefix.
      ChatGPT and Codex user data is left in place when this formula is removed.
      The Linux preview's Wayland Computer Use, Remote, Global Dictation, and
      Record & Replay support still require validation on the target desktop.
    EOS
  end

  private

  def verify_sha256(path)
    expected = PACKAGE_SHA256.fetch(PACKAGE_ARCHITECTURE)
    actual = Digest::SHA256.file(path).hexdigest
    odie "ChatGPT DEB SHA-256 does not match the pinned artifact" unless actual == expected
  end

  def control_field(contents, field)
    contents.lines.each do |line|
      return line.split(":", 2).last.strip if line.start_with?("#{field}:")
    end

    nil
  end

  def extract_archive(archive, destination)
    command = case archive
    when /\.tar\.gz$/
      ["tar", "-xzf", archive, "-C", destination]
    when /\.tar\.xz$/
      ["tar", "-xJf", archive, "-C", destination]
    when /\.tar\.zst$/
      ["tar", "--use-compress-program=unzstd", "-xf", archive, "-C", destination]
    else
      ["tar", "-xf", archive, "-C", destination]
    end
    odie "Unable to extract ChatGPT archive #{archive}" unless system(*command)
  end
end

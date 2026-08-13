cask "codex-desktop" do
  arch intel: "amd64"
  os linux: "linux"

  version "26.803.81509.patchraptor.380fb5654dac"
  sha256 x86_64_linux: "970196218026fff1427f511a3974609253b4667b118377c4b92e9e525f0edeb5"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-desktop-linux-26.803.81509.patchraptor.380fb5654dac/codex-desktop-linux-26.803.81509.patchraptor.380fb5654dac-amd64.deb"
  name "Codex Desktop"
  desc "ChatGPT Community Linux desktop app built from PatchRaptor main"
  homepage "https://github.com/joshyorko/codex-desktop-linux"

  livecheck do
    skip "Built from the pinned PatchRaptor main commit by the tap release pipeline."
  end

  binary "usr/bin/codex-desktop"
  artifact "usr/share/applications/codex-desktop.desktop",
           target: "#{Dir.home}/.local/share/applications/codex-desktop.desktop"
  artifact "usr/share/icons/hicolor/256x256/apps/codex-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png"

  preflight do
    package = Dir["#{staged_path}/*.deb"].first
    raise "unable to find Codex Desktop .deb in #{staged_path}" unless package

    system "ar", "x", package, chdir: staged_path
    data_archive = Dir["#{staged_path}/data.tar.*"].first
    raise "unable to find data archive in #{package}" unless data_archive

    case data_archive
    when /\.tar\.gz$/
      system "tar", "-xzf", data_archive, "-C", staged_path
    when /\.tar\.xz$/
      system "tar", "-xJf", data_archive, "-C", staged_path
    when /\.tar\.zst$/
      system "sh", "-c", "unzstd -c '#{data_archive}' | tar -xf - -C '#{staged_path}'"
    else
      system "tar", "-xf", data_archive, "-C", staged_path
    end

    desktop_file = "#{staged_path}/usr/share/applications/codex-desktop.desktop"
    desktop_contents = File.read(desktop_file)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/codex-desktop %u")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png"
    )
    File.write(desktop_file, desktop_contents)
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/codex-desktop.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png",
  ]

  caveats <<~EOS
    Launch Codex Desktop with:
      codex-desktop

    This cask is built from the official OpenAI Linux package by PatchRaptor
    main. Homebrew owns upgrades; the native package updater is omitted.
  EOS
end

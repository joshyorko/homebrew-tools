import { parseArgs } from "node:util"

const { values } = parseArgs({ options: {
  version: { type: "string" },
  "x86-64-sha256": { type: "string" },
  "aarch64-sha256": { type: "string" },
  "candidate-url": { type: "string" },
} })
const version = values.version
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected stable --version (for example 0.1.0)")
for (const key of ["x86-64-sha256", "aarch64-sha256"]) {
  if (!/^[a-f0-9]{64}$/.test(values[key] ?? "")) throw new Error(`Expected verified --${key}`)
}
const candidate = values["candidate-url"]
if (candidate && !/^file:\/\/\/[A-Za-z0-9/._-]+$/.test(candidate)) throw new Error("Candidate URL must be an absolute local file URL")
const url = (arch) => candidate ?? `https://github.com/joshyorko/review/releases/download/v${version}/review-${arch}.tar.gz`
process.stdout.write(`class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "${version}"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "${url("x86_64")}"
      sha256 "${values["x86-64-sha256"]}"
    end
    on_arm do
      url "${url("aarch64")}"
      sha256 "${values["aarch64-sha256"]}"
    end
  end

  depends_on :linux
  depends_on "apptainer"
  depends_on "squashfuse"
  depends_on "gh"

  def install
    bin.install "review"
    libexec.install "launcher", "build.json", "build.txt", "LICENSE", "NOTICE"
  end

  test do
    assert_match "Usage", shell_output("#{bin}/review --help")
    assert_path_exists libexec/"launcher/review.sif"
    assert_path_exists libexec/"build.json"
  end
end
`)

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("publish-rcc-release.sh").resolve()
NAMES = ["rcc-linux64", "rcc-linuxarm64", "rcc-macos64", "rcc-macosarm64"]


class RCCPublishTests(unittest.TestCase):
    def test_publishing_requires_exact_assets_and_preserves_existing_releases(self):
        for mode in ["new", "matching", "incomplete", "corrupt", "draft", "api_error", "missing_bundle_asset"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                assets = root / "artifacts"
                assets.mkdir()
                for name in NAMES:
                    if mode != "missing_bundle_asset" or name != "rcc-linuxarm64":
                        (assets / name).write_text(name)
                release = {
                    "draft": mode == "draft",
                    "immutable": mode == "matching",
                    "assets": [
                        {"name": name, "digest": f"sha256:{hashlib.sha256(name.encode()).hexdigest()}"}
                        for name in NAMES if mode != "incomplete" or name != "rcc-linuxarm64"
                    ],
                }
                if mode == "corrupt":
                    release["assets"][1]["digest"] = "sha256:" + "0" * 64
                (root / "release.json").write_text(json.dumps(release))
                gh = root / "gh"
                gh.write_text("""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == api ]]; then
  if [[ "$MODE" == api_error ]]; then
    echo 'gh: API rate limit exceeded (HTTP 403)' >&2
    exit 1
  fi
  if [[ "$MODE" == new && ! -f "$TEST_DIR/writes" ]]; then
    echo 'gh: Not Found (HTTP 404)' >&2
    exit 1
  fi
  cat "$TEST_DIR/release.json"
else
  printf '%s\n' "$@" >> "$TEST_DIR/writes"
fi
""")
                gh.chmod(0o755)
                result = subprocess.run(
                    ["bash", str(SCRIPT), temp, "rcc-18.19.12", "RCC", str(root / "notes")],
                    env={**os.environ, "PATH": f"{root}:{os.environ['PATH']}", "MODE": mode,
                         "TEST_DIR": temp, "GITHUB_REPOSITORY": "joshyorko/homebrew-tools"},
                    text=True, capture_output=True,
                )
                self.assertEqual(mode in {"new", "matching"}, result.returncode == 0, result.stderr)
                writes = root / "writes"
                self.assertEqual(mode == "new", writes.exists())
                if mode == "new":
                    commands = writes.read_text().splitlines()
                    self.assertEqual(["release", "create", "rcc-18.19.12"], commands[:3])
                    self.assertEqual([str(assets / name) for name in NAMES], commands[3:7])
                    self.assertNotIn("--clobber", commands)


if __name__ == "__main__":
    unittest.main()

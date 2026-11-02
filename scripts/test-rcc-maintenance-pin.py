import hashlib
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pin", ROOT / "scripts/rcc-maintenance-pin.py")
pin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pin)
CASK = (ROOT / "Casks/rcc.rb").read_text()
CURRENT = dict(line.split("=", 1) for line in pin.resolve_pin(CASK).splitlines())
WORKFLOW = (ROOT / ".github/workflows/rcc-maintenance.yml").read_text()
SCRIPT = re.search(r'    - name: Install RCC\n      run: \|\n(.*?)\n    - name:', WORKFLOW, re.S)[1]
SCRIPT = "\n".join(line[8:] for line in SCRIPT.splitlines())
PAYLOAD = b'#!/bin/bash\nprintf verified > "$EXECUTED"\n'


class RCCPinTests(unittest.TestCase):
    def test_release_bump_keeps_url_version_and_digest_together(self):
        old = dict(line.split("=", 1) for line in pin.resolve_pin(CASK).splitlines())
        updated = CASK.replace(old["RCC_VERSION"], "18.20.0").replace(old["RCC_SHA256"], "a" * 64)
        new = dict(line.split("=", 1) for line in pin.resolve_pin(updated).splitlines())
        self.assertEqual("18.20.0", new["RCC_VERSION"])
        self.assertEqual("a" * 64, new["RCC_SHA256"])
        self.assertEqual("https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.20.0/rcc-linux64", new["RCC_URL"])

    def test_rejects_missing_ambiguous_or_mismatched_pin(self):
        for bad in [
            CASK.replace(f'version "{CURRENT["RCC_VERSION"]}"', 'version "99.0.0"'),
            CASK.replace('  on_linux do', '  on_other do'),
            CASK + '\n  version "99.0.0"\n',
            CASK.replace('/rcc-linux64"', '/wrong"'),
            CASK.replace('https://github.com/', 'https://example.com/'),
            CASK.replace(f'    sha256 "{CURRENT["RCC_SHA256"]}"', '    sha256 :no_check'),
        ]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                pin.resolve_pin(bad)

    def test_workflow_uses_pin_and_no_version_only_updater(self):
        self.assertIn('python3 scripts/rcc-maintenance-pin.py Casks/rcc.rb >> "$GITHUB_ENV"', WORKFLOW)
        self.assertNotIn('RCC_VERSION=', WORKFLOW)
        for path in ['.github/renovate.json5', 'automation/maintenance-robot/allowlists/workflow_versions.json']:
            self.assertNotIn('RCC_VERSION', (ROOT / path).read_text())

    def test_download_and_cache_fail_closed_before_execution(self):
        for cached in [False, True]:
            for valid in [False, True]:
                with self.subTest(cached=cached, valid=valid), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    bin_dir = root / 'bin'
                    bin_dir.mkdir()
                    payload = root / 'payload'
                    payload.write_bytes(PAYLOAD if valid else PAYLOAD + b'# tampered\n')
                    fake_curl = bin_dir / 'curl'
                    fake_curl.write_text('#!/bin/bash\nset -eu\nprintf "%s\\n" "$2" > "$CURL_URL_FILE"\ncp "$PAYLOAD" "$4"\n')
                    fake_curl.chmod(0o755)
                    target = root / '.tools/rcc/18.20.0/rcc'
                    if cached:
                        target.parent.mkdir(parents=True)
                        target.write_bytes(payload.read_bytes())
                        target.chmod(0o755)
                    env = {**os.environ, 'PATH': f'{bin_dir}:{os.environ["PATH"]}',
                           'GITHUB_WORKSPACE': str(root), 'GITHUB_PATH': str(root / 'path'),
                           'RCC_VERSION': '18.20.0', 'RCC_SHA256': hashlib.sha256(PAYLOAD).hexdigest(),
                           'RCC_URL': 'https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.20.0/rcc-linux64',
                           'EXECUTED': str(root / 'executed'), 'CURL_URL_FILE': str(root / 'url'), 'PAYLOAD': str(payload)}
                    result = subprocess.run(['bash', '-c', SCRIPT], env=env, text=True, capture_output=True)
                    self.assertEqual(valid, result.returncode == 0, result.stderr)
                    self.assertEqual(valid, (root / 'executed').exists())
                    self.assertEqual(valid, (root / 'path').exists())
                    self.assertEqual(not cached, (root / 'url').exists())
                    if not cached:
                        self.assertEqual(env['RCC_URL'], (root / 'url').read_text().strip())


if __name__ == '__main__':
    unittest.main()

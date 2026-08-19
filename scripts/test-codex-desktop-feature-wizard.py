#!/usr/bin/env python3
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("codex-desktop-feature-wizard.py")
SPEC = importlib.util.spec_from_file_location("codex_desktop_feature_wizard", MODULE_PATH)
WIZARD = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = WIZARD
SPEC.loader.exec_module(WIZARD)


class FeatureWizardTests(unittest.TestCase):
    def test_result_records_latest_signed_linux_package(self):
        with tempfile.TemporaryDirectory() as directory:
            result = Path(directory) / "result.json"
            WIZARD.write_result(result, "install", {"record-and-replay"}, "latest")
            self.assertEqual(
                json.loads(result.read_text()),
                {"action": "install", "packageSource": "latest", "features": ["record-and-replay"]},
            )

    def test_result_rejects_unknown_linux_package_source(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Unknown Linux package source"):
                WIZARD.write_result(Path(directory) / "result.json", "install", set(), "dmg")


if __name__ == "__main__":
    unittest.main()

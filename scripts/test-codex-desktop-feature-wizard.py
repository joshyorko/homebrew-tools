#!/usr/bin/env python3

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("codex-desktop-feature-wizard.py")
SPEC = importlib.util.spec_from_file_location("codex_desktop_feature_wizard", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
WIZARD = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = WIZARD
SPEC.loader.exec_module(WIZARD)


class FeatureWizardModelTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name) / "linux-features"
        self.root.mkdir()

    def add_feature(
        self,
        directory_name,
        *,
        feature_id=None,
        title=None,
        description="",
        requires=(),
        conflicts=(),
        readme=True,
    ):
        feature_id = feature_id or directory_name
        feature_directory = self.root / directory_name
        feature_directory.mkdir()
        (feature_directory / "feature.json").write_text(
            json.dumps(
                {
                    "id": feature_id,
                    "title": title or feature_id.replace("-", " ").title(),
                    "description": description,
                    "requires": list(requires),
                    "conflicts": list(conflicts),
                    "defaultEnabled": False,
                }
            )
            + "\n"
        )
        if readme:
            (feature_directory / "README.md").write_text(f"# {feature_id}\n")

    def test_discovers_feature_metadata_and_categories(self):
        self.add_feature(
            "conversation-mode",
            title="Conversation Mode",
            description="Hands-free conversation.",
            requires=("read-aloud",),
        )
        self.add_feature("read-aloud", title="Read Aloud")

        features = WIZARD.discover_features(self.root)

        self.assertEqual(list(features), ["conversation-mode", "read-aloud"])
        self.assertEqual(features["conversation-mode"].requires, ("read-aloud",))
        self.assertEqual(features["conversation-mode"].category, "Voice & conversation")

    def test_rejects_duplicate_feature_ids(self):
        self.add_feature("first", feature_id="duplicate")
        self.add_feature("second", feature_id="duplicate")

        with self.assertRaisesRegex(ValueError, "Duplicate Linux feature id 'duplicate'"):
            WIZARD.discover_features(self.root)

    def test_rejects_feature_without_readme(self):
        self.add_feature("undocumented", readme=False)

        with self.assertRaisesRegex(ValueError, "must include README.md"):
            WIZARD.discover_features(self.root)

    def test_rejects_unknown_requirement(self):
        self.add_feature("conversation-mode", requires=("read-aloud",))

        with self.assertRaisesRegex(ValueError, "requires unknown feature 'read-aloud'"):
            WIZARD.discover_features(self.root)

    def test_missing_config_uses_default_profile(self):
        self.add_feature("read-aloud")
        features = WIZARD.discover_features(self.root)

        selected = WIZARD.load_selection(
            self.root / "features.json",
            features,
            {"read-aloud"},
        )

        self.assertEqual(selected, {"read-aloud"})

    def test_rejects_malformed_config(self):
        self.add_feature("read-aloud")
        features = WIZARD.discover_features(self.root)
        config = self.root / "features.json"
        config.write_text('{"enabled": "read-aloud"}\n')

        with self.assertRaisesRegex(ValueError, "enabled must be an array"):
            WIZARD.load_selection(config, features, set())

    def test_enabling_feature_adds_requirements(self):
        self.add_feature("read-aloud", title="Read Aloud")
        self.add_feature(
            "conversation-mode",
            title="Conversation Mode",
            requires=("read-aloud",),
        )
        features = WIZARD.discover_features(self.root)

        selected, notice = WIZARD.toggle_feature(
            features,
            set(),
            "conversation-mode",
            True,
        )

        self.assertEqual(selected, {"conversation-mode", "read-aloud"})
        self.assertIn("Read Aloud", notice)

    def test_conflict_preserves_selection(self):
        self.add_feature("first", conflicts=("second",))
        self.add_feature("second")
        features = WIZARD.discover_features(self.root)

        selected, notice = WIZARD.toggle_feature(features, {"second"}, "first", True)

        self.assertEqual(selected, {"second"})
        self.assertIn("conflicts", notice)

    def test_disabling_requirement_disables_dependents(self):
        self.add_feature("read-aloud", title="Read Aloud")
        self.add_feature(
            "conversation-mode",
            title="Conversation Mode",
            requires=("read-aloud",),
        )
        features = WIZARD.discover_features(self.root)

        selected, notice = WIZARD.toggle_feature(
            features,
            {"conversation-mode", "read-aloud"},
            "read-aloud",
            False,
        )

        self.assertEqual(selected, set())
        self.assertIn("Conversation Mode", notice)

    def test_save_selection_is_stable_and_atomic(self):
        config = self.root / "features.json"

        WIZARD.save_selection(config, {"read-aloud", "pet-overlay"})

        self.assertEqual(
            json.loads(config.read_text()),
            {"enabled": ["pet-overlay", "read-aloud"]},
        )
        self.assertFalse(config.with_suffix(".json.tmp").exists())

    def test_empty_selection_uses_explicit_none_sentinel(self):
        self.assertEqual(WIZARD.selection_argument(set()), "none")

    def test_install_result_is_stable(self):
        result = self.root / "result.json"

        WIZARD.write_result(result, "install", {"read-aloud", "pet-overlay"})

        self.assertEqual(
            json.loads(result.read_text()),
            {
                "action": "install",
                "features": ["pet-overlay", "read-aloud"],
            },
        )

    def test_cancel_preserves_saved_selection(self):
        config = self.root / "features.json"
        result = self.root / "result.json"
        WIZARD.save_selection(config, {"read-aloud"})

        WIZARD.complete_action("cancel", config, result, {"pet-overlay"})

        self.assertEqual(json.loads(config.read_text()), {"enabled": ["read-aloud"]})
        self.assertEqual(json.loads(result.read_text()), {"action": "cancel", "features": []})

    def test_save_action_persists_selection(self):
        config = self.root / "features.json"
        result = self.root / "result.json"

        WIZARD.complete_action("save", config, result, {"pet-overlay"})

        self.assertEqual(json.loads(config.read_text()), {"enabled": ["pet-overlay"]})
        self.assertEqual(
            json.loads(result.read_text()),
            {"action": "save", "features": ["pet-overlay"]},
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

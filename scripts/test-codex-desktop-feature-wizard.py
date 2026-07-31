#!/usr/bin/env python3

import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock


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

    def test_record_replay_uses_standalone_chronicle_dependency(self):
        self.add_feature(
            "chronicle-skysight",
            title="Chronicle / Skysight Activity Memory",
        )
        self.add_feature(
            "record-and-replay",
            title="Record & Replay",
            requires=("chronicle-skysight",),
        )
        features = WIZARD.discover_features(self.root)

        selected, notice = WIZARD.toggle_feature(
            features,
            set(),
            "record-and-replay",
            True,
        )

        self.assertEqual(selected, {"chronicle-skysight", "record-and-replay"})
        self.assertIn("Chronicle / Skysight Activity Memory", notice)
        self.assertEqual(features["chronicle-skysight"].category, "Capture & memory")
        self.assertEqual(features["record-and-replay"].category, "Capture & memory")

        selected, notice = WIZARD.toggle_feature(
            features,
            selected,
            "chronicle-skysight",
            False,
        )
        self.assertEqual(selected, set())
        self.assertIn("Record & Replay", notice)

    def test_saved_record_replay_selection_restores_chronicle_dependency(self):
        self.add_feature("chronicle-skysight")
        self.add_feature(
            "record-and-replay",
            requires=("chronicle-skysight",),
        )
        features = WIZARD.discover_features(self.root)
        config = self.root / "features.json"
        config.write_text('{"enabled": ["record-and-replay"]}\n')

        selected = WIZARD.load_selection(config, features, set())

        self.assertEqual(selected, {"chronicle-skysight", "record-and-replay"})

    def test_makefile_profiles_include_chronicle_dependency(self):
        makefile = MODULE_PATH.parent.parent.joinpath("Makefile").read_text()
        profile_lines = [
            line
            for line in makefile.splitlines()
            if line.startswith("CODEX_DESKTOP_LINUX_FEATURES_")
            and " := " in line
        ]

        self.assertEqual(len(profile_lines), 2)
        for line in profile_lines:
            feature_ids = line.split(" := ", 1)[1].split()
            self.assertIn("chronicle-skysight", feature_ids)
            self.assertIn("record-and-replay", feature_ids)
            self.assertLess(
                feature_ids.index("chronicle-skysight"),
                feature_ids.index("record-and-replay"),
            )

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

    def test_markup_text_escapes_ampersands(self):
        self.assertEqual(WIZARD.markup_text("Record & Replay"), "Record &amp; Replay")

    def test_install_result_is_stable(self):
        result = self.root / "result.json"

        WIZARD.write_result(result, "install", {"read-aloud", "pet-overlay"})

        self.assertEqual(
            json.loads(result.read_text()),
            {
                "action": "install",
                "dmgSource": "pinned",
                "features": ["pet-overlay", "read-aloud"],
            },
        )

    def test_install_result_accepts_latest_dmg_source(self):
        result = self.root / "result.json"

        WIZARD.write_result(result, "install", {"read-aloud"}, "latest")

        self.assertEqual(json.loads(result.read_text())["dmgSource"], "latest")

    def test_result_rejects_unknown_dmg_source(self):
        with self.assertRaisesRegex(ValueError, "Unknown DMG source"):
            WIZARD.write_result(
                self.root / "result.json",
                "install",
                set(),
                "surprise",
            )

    def test_latest_dmg_summary_identifies_matching_tested_pin(self):
        summary = WIZARD.build_latest_dmg_summary(
            pinned={
                "sha256": "c243c94f8de6a51f5530ffe1f8d0c1588733d890ac692e34aaca06d95ba637ca",
                "contentLength": "615738501",
                "lastModified": "Mon, 13 Jul 2026 06:53:09 GMT",
                "etag": "0x8DEE0AB667193CC",
            },
            latest={
                "probeStatus": "available",
                "contentLength": "615738501",
                "lastModified": "Mon, 13 Jul 2026 06:53:09 GMT",
                "etag": "0x8DEE0AB667193CC",
            },
        )

        self.assertEqual(summary["status"], "Matches tested pin")
        self.assertTrue(summary["subtitle"].startswith("Matches tested pin\n"))
        self.assertIn("SHA256 c243c94f8de6a51f…", summary["subtitle"])
        self.assertIn("587.2 MiB", summary["subtitle"])
        self.assertIn("Mon, 13 Jul 2026 06:53:09 GMT", summary["subtitle"])
        self.assertIn("ETag 0x8DEE0AB667193CC", summary["subtitle"])

    def test_latest_dmg_summary_flags_different_upstream_artifact(self):
        summary = WIZARD.build_latest_dmg_summary(
            pinned={
                "sha256": "a" * 64,
                "contentLength": "615738501",
                "lastModified": "Mon, 13 Jul 2026 06:53:09 GMT",
                "etag": "tested-etag",
            },
            latest={
                "probeStatus": "available",
                "contentLength": "620000000",
                "lastModified": "Tue, 14 Jul 2026 12:00:00 GMT",
                "etag": "new-etag",
            },
        )

        self.assertEqual(summary["status"], "Different upstream artifact detected")
        self.assertNotIn("SHA256", summary["subtitle"])
        self.assertIn("591.3 MiB", summary["subtitle"])
        self.assertIn("ETag new-etag", summary["subtitle"])

    def test_latest_dmg_summary_reports_unavailable_probe(self):
        summary = WIZARD.build_latest_dmg_summary(
            pinned={
                "sha256": "a" * 64,
                "contentLength": "615738501",
                "lastModified": "Mon, 13 Jul 2026 06:53:09 GMT",
                "etag": "tested-etag",
            },
            latest={
                "probeStatus": "unavailable",
                "contentLength": "unknown",
                "lastModified": "unknown",
                "etag": "unknown",
            },
        )

        self.assertEqual(summary["status"], "Unable to check newest upstream DMG")
        self.assertTrue(
            summary["subtitle"].startswith("Unable to check newest upstream DMG\n")
        )
        self.assertIn("No download has started", summary["subtitle"])

    def test_result_summary_exposes_drift_blocker_and_report(self):
        evidence_dir = self.root / "evidence"
        summary = WIZARD.build_result_summary(
            {
                "verdict": "rejected",
                "blockers": [
                    {
                        "name": "feature:appshots:availability",
                        "reason": "availability gate moved",
                    }
                ],
            },
            evidence_dir,
        )

        self.assertEqual(summary["title"], "Newest upstream DMG rejected")
        self.assertIn("availability gate moved", summary["description"])
        self.assertEqual(
            summary["reportPath"],
            evidence_dir / "upstream-dmg-decision.json",
        )

    def test_result_summary_marks_accepted_with_warnings(self):
        summary = WIZARD.build_result_summary(
            {
                "verdict": "accepted_with_warnings",
                "warnings": [{"reason": "optional core diagnostic moved"}],
            },
            self.root,
        )

        self.assertEqual(summary["title"], "Accepted with warnings")
        self.assertIn("optional core diagnostic moved", summary["description"])

    def test_headless_result_view_prints_verdict_and_report(self):
        evidence_dir = self.root / "evidence"
        evidence_dir.mkdir()
        result = evidence_dir / "upstream-dmg-decision.json"
        result.write_text(json.dumps({"verdict": "accepted"}) + "\n")
        output = io.StringIO()

        with (
            mock.patch.object(WIZARD, "graphical_session_available", return_value=False),
            redirect_stdout(output),
        ):
            status = WIZARD.show_build_result(result)

        self.assertEqual(status, 0)
        self.assertIn("Newest upstream DMG accepted", output.getvalue())
        self.assertIn(str(result), output.getvalue())

    def test_cancel_preserves_saved_selection(self):
        config = self.root / "features.json"
        result = self.root / "result.json"
        WIZARD.save_selection(config, {"read-aloud"})

        WIZARD.complete_action("cancel", config, result, {"pet-overlay"})

        self.assertEqual(json.loads(config.read_text()), {"enabled": ["read-aloud"]})
        self.assertEqual(
            json.loads(result.read_text()),
            {"action": "cancel", "dmgSource": "pinned", "features": []},
        )

    def test_save_action_persists_selection(self):
        config = self.root / "features.json"
        result = self.root / "result.json"

        WIZARD.complete_action("save", config, result, {"pet-overlay"})

        self.assertEqual(json.loads(config.read_text()), {"enabled": ["pet-overlay"]})
        self.assertEqual(
            json.loads(result.read_text()),
            {"action": "save", "dmgSource": "pinned", "features": ["pet-overlay"]},
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

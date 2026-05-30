from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from packaging.version import Version

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import maintenance_robot.github_actions as github_actions
from maintenance_robot.github_api import ReleaseInfo
from maintenance_robot.github_actions import GitHubActionsUpdater
from maintenance_robot.reporter import MaintenanceReport


class GitHubActionsUpdaterTests(unittest.TestCase):
    def test_updates_allowlisted_workflow_versions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workflows_dir = Path(temp_dir) / ".github" / "workflows"
            workflows_dir.mkdir(parents=True)
            workflow = workflows_dir / "tap-ci.yml"
            workflow.write_text(
                """name: Tap CI

env:
  DAGGER_VERSION: "0.20.6"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/setup-node@oldsha # v6.4.0
      with:
        node-version: "22"
    - run: |
        echo "RCC_VERSION=v18.17.4" >> "$GITHUB_ENV"
""",
                encoding="utf-8",
            )

            def fake_fetch_latest_version(**kwargs):
                repo = kwargs["repo"]
                releases = {
                    "dagger/dagger": ReleaseInfo(tag="v0.20.8", version=Version("0.20.8"), sha="daggersha"),
                    "joshyorko/rcc": ReleaseInfo(tag="v18.17.5", version=Version("18.17.5"), sha="rccsha"),
                    "nodejs/node": ReleaseInfo(tag="v24.11.1", version=Version("24.11.1"), sha="nodesha"),
                }
                return releases[repo]

            original_fetch = github_actions.fetch_latest_version
            github_actions.fetch_latest_version = fake_fetch_latest_version
            try:
                report = MaintenanceReport()
                updater = GitHubActionsUpdater(
                    allowlist={},
                    version_allowlist={
                        "env": {
                            "DAGGER_VERSION": {
                                "repo": "dagger/dagger",
                                "source": "release",
                                "max_major": 0,
                                "value_prefix": "",
                            },
                        },
                        "run_exports": {
                            "RCC_VERSION": {
                                "repo": "joshyorko/rcc",
                                "source": "release",
                                "max_major": 18,
                                "value_prefix": "v",
                            },
                        },
                        "with": {
                            "node-version": {
                                "repo": "nodejs/node",
                                "source": "release",
                                "max_major": 24,
                                "major_only": True,
                            },
                        },
                    },
                    report=report,
                )

                self.assertEqual({"workflows/tap-ci.yml"}, updater.update_workflows(workflows_dir))
            finally:
                github_actions.fetch_latest_version = original_fetch

            updated = workflow.read_text(encoding="utf-8")
            self.assertIn('DAGGER_VERSION: "0.20.8"', updated)
            self.assertIn('node-version: "24"', updated)
            self.assertIn('echo "RCC_VERSION=v18.17.5" >> "$GITHUB_ENV"', updated)
            self.assertEqual(
                [
                    ("DAGGER_VERSION", "0.20.6", "0.20.8"),
                    ("node-version", "22", "24"),
                    ("RCC_VERSION", "v18.17.4", "v18.17.5"),
                ],
                [(item.name, item.previous, item.updated) for item in report.workflow_versions],
            )


if __name__ == "__main__":
    unittest.main()

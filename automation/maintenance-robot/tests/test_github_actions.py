from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from packaging.version import Version
from ruamel.yaml import YAML

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


class RCCMaintenanceWorkflowTests(unittest.TestCase):
    def test_maintenance_job_has_bounded_timeout(self) -> None:
        workflow_path = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "rcc-maintenance.yml"
        workflow = YAML(typ="safe").load(workflow_path.read_text(encoding="utf-8"))

        self.assertEqual(30, workflow["jobs"]["maintenance"]["timeout-minutes"])

    def test_install_rcc_uses_single_release_prefix_and_stable_cache_path(self) -> None:
        workflow_path = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "rcc-maintenance.yml"
        workflow = workflow_path.read_text(encoding="utf-8")
        match = re.search(
            r"(?m)^    - name: Install RCC\n      run: \|\n(?P<script>(?:(?:        .*)?\n)*?)^    - name:",
            workflow,
        )
        self.assertIsNotNone(match)
        install_script = "".join(line[8:] for line in match.group("script").splitlines(keepends=True))

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            fake_bin_dir = root / "bin"
            fake_bin_dir.mkdir()
            curl_url_path = root / "curl-url"
            fake_curl = fake_bin_dir / "curl"
            fake_curl.write_text(
                """#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while (($# > 0)); do
  case "$1" in
    http://*|https://*) url="$1"; shift ;;
    -o) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" > "$CURL_URL_FILE"
printf '#!/usr/bin/env bash\\nexit 0\\n' > "$output"
""",
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)
            github_path = root / "github-path"
            environment = os.environ.copy()
            environment.update(
                {
                    "CURL_URL_FILE": str(curl_url_path),
                    "GITHUB_PATH": str(github_path),
                    "GITHUB_WORKSPACE": str(root),
                    "PATH": f"{fake_bin_dir}:{environment['PATH']}",
                    "RCC_VERSION": "v18.19.3",
                }
            )

            result = subprocess.run(
                ["bash", "-c", install_script],
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(0, result.returncode, result.stderr)
            expected_dir = root / ".tools" / "rcc" / "v18.19.3"
            self.assertEqual(
                "https://github.com/joshyorko/rcc/releases/download/v18.19.3/rcc-linux64",
                curl_url_path.read_text(encoding="utf-8").strip(),
            )
            self.assertTrue((expected_dir / "rcc").is_file())
            self.assertEqual(f"{expected_dir}\n", github_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

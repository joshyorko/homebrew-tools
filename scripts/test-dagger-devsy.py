import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
FAKE = r'''#!/usr/bin/env python3
import io, json, os, pathlib, sys, tarfile, time
state = pathlib.Path(os.environ["BUILDER_TEST_STATE"])
name = pathlib.Path(sys.argv[0]).name
with (state / "calls").open("a") as log:
    log.write(json.dumps([name, *sys.argv[1:]]) + "\n")
if name == "devsy":
    if "list" in sys.argv:
        provider = os.environ.get("BUILDER_TEST_PROVIDER", "harvester")
        print(json.dumps([{"id": "homebrew-tools-dagger", "provider": {"name": provider}}]) if provider else "[]")
    else:
        failed = os.environ.get("BUILDER_TEST_UP_FAILURE")
        print(json.dumps({"kind": "result", "outcome": "error" if failed else "success"}))
        if os.environ.get("BUILDER_TEST_LINGER"):
            sys.stdout.flush()
            time.sleep(60)
        sys.exit(1 if failed else 0)
elif name == "ssh":
    command = sys.argv[-1]
    if "mktemp" in command:
        print("/builds/homebrew-tools/run.TEST0001")
    elif command.startswith("tar -xf"):
        (state / "upload.tar").write_bytes(sys.stdin.buffer.read())
    elif command.startswith("bash "):
        print("remote dagger result")
        sys.exit(int(os.environ.get("BUILDER_TEST_EXIT", "0")))
    elif command.startswith("tar -C"):
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
            data = b"verified remote artifact\n"
            item = tarfile.TarInfo("payload/result.txt" if os.environ.get("BUILDER_TEST_DIRECTORY") else "payload")
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    else:
        sys.exit(98)
else:
    sys.exit(99)
'''


class RemoteBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "checkout with spaces"
        self.repo.mkdir()
        (self.repo / "scripts").mkdir()
        shutil.copy(ROOT / "scripts/dagger-devsy.sh", self.repo / "scripts")
        shutil.copy(ROOT / "scripts/dagger-limited.sh", self.repo / "scripts")
        shutil.copytree(ROOT / ".devcontainer/dagger", self.repo / ".devcontainer/dagger")
        (self.repo / "tracked").write_text("committed\n")
        (self.repo / "deleted").write_text("remove me\n")
        (self.repo / ".gitignore").write_text("ignored\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
        self.state = self.base / "state"
        self.state.mkdir()
        tools = self.base / "bin"
        tools.mkdir()
        for name in ("devsy", "ssh", "docker", "dagger"):
            path = tools / name
            path.write_text(FAKE)
            path.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{tools}:{os.environ['PATH']}",
            "XDG_CACHE_HOME": str(self.base / "cache"),
            "BUILDER_TEST_STATE": str(self.state),
        }
        self.env.pop("DAGGER_DEVSY_WORKSPACE", None)

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True).strip()

    def run_builder(self, *args, legacy=False, **env):
        script = "dagger-limited.sh" if legacy else "dagger-devsy.sh"
        result = subprocess.run(
            ["bash", str(self.repo / "scripts" / script), *args],
            cwd=self.base, env={**self.env, **env}, capture_output=True, text=True, timeout=30,
        )
        calls = [json.loads(line) for line in (self.state / "calls").read_text().splitlines()]
        self.assertFalse(any(call[0] in ("docker", "dagger") for call in calls), calls)
        return result, calls

    def upload(self):
        return tarfile.open(self.state / "upload.tar")

    def test_uploads_dirty_checkout_and_preserves_arguments(self):
        (self.repo / "tracked").write_text("edited\n")
        (self.repo / "deleted").unlink()
        (self.repo / "new file").write_text("untracked\n")
        (self.repo / "ignored").write_text("excluded\n")
        argument = "a 'quote' \"double\" $HOME $(touch nope)\nnext line"
        result, _ = self.run_builder("-m", "./dagger/test", "call", "probe", argument, "--git-dir=.git")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("remote dagger result", result.stdout)
        with self.upload() as uploaded:
            argv = uploaded.extractfile("arguments").read().split(b"\0")[:-1]
            self.assertIn(argument.encode(), argv)
            self.assertEqual(argv[-1], b"--git-dir=.git")
            with tarfile.open(fileobj=io.BytesIO(uploaded.extractfile("source.tar").read())) as source:
                self.assertEqual(source.extractfile("tracked").read(), b"edited\n")
                self.assertEqual(source.extractfile("new file").read(), b"untracked\n")
                self.assertNotIn("deleted", source.getnames())
                self.assertNotIn("ignored", source.getnames())
                self.assertNotIn(".git", source.getnames())
            bundle = self.base / "verify.bundle"
            bundle.write_bytes(uploaded.extractfile("repository.bundle").read())
            self.git("bundle", "verify", str(bundle))

    def test_worktree_git_directory_is_relocated(self):
        original = self.repo
        self.git("worktree", "add", "-qb", "build", str(self.base / "worktree"))
        self.repo = self.base / "worktree"
        git_dir = self.git("rev-parse", "--git-common-dir")
        result, _ = self.run_builder("call", "probe", f"--git-dir={git_dir}")
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.upload() as uploaded:
            self.assertIn(b"--git-dir=.git\0", uploaded.extractfile("arguments").read())
        self.repo = original

    def test_absolute_module_git_and_ignored_bundle_inputs_are_relocated(self):
        bundle = self.repo / "ignored"
        bundle.mkdir()
        (bundle / "artifact").write_text("retained artifact\n")
        result, _ = self.run_builder(
            "-m", str(self.repo / "dagger/tap-pipeline"), "call", "offline-smoke",
            "--bundle", str(bundle), "--git-dir", str(self.repo / ".git"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.upload() as uploaded:
            argv = uploaded.extractfile("arguments").read().split(b"\0")[:-1]
            self.assertIn(b"./dagger/tap-pipeline", argv)
            self.assertIn(b"--bundle=../input-bundle", argv)
            self.assertIn(b"--git-dir=.git", argv)
            with tarfile.open(fileobj=io.BytesIO(uploaded.extractfile("bundle.tar").read())) as exported:
                self.assertEqual(exported.extractfile("./artifact").read(), b"retained artifact\n")

    def test_remote_failure_preserves_exit_status_and_existing_output(self):
        output = self.repo / "result.txt"
        output.write_text("keep me\n")
        result, calls = self.run_builder("call", "probe", "-o", str(output), BUILDER_TEST_EXIT="42")
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(output.read_text(), "keep me\n")
        self.assertFalse(any(call[0] == "ssh" and call[-1].startswith("tar -C") for call in calls))

    def test_file_export_through_legacy_entrypoint(self):
        output = self.repo / "dist/result.txt"
        result, _ = self.run_builder("call", "probe", f"--output={output}", legacy=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_text(), "verified remote artifact\n")

    def test_directory_export_preserves_existing_files(self):
        output = self.repo / "dist/bundle"
        output.mkdir(parents=True)
        (output / "keep").write_text("existing\n")
        result, _ = self.run_builder("call", "probe", "-o", str(output), BUILDER_TEST_DIRECTORY="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((output / "result.txt").read_text(), "verified remote artifact\n")
        self.assertEqual((output / "keep").read_text(), "existing\n")

    def test_wrong_provider_never_runs_or_changes_existing_workspace(self):
        result, calls = self.run_builder("call", "probe", BUILDER_TEST_PROVIDER="docker")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] == "ssh" or "up" in call for call in calls))

    def test_provisioning_failure_never_runs_build(self):
        result, calls = self.run_builder("call", "probe", BUILDER_TEST_PROVIDER="", BUILDER_TEST_UP_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] == "ssh" for call in calls))

    def test_terminal_success_does_not_wait_for_local_tunnel_to_exit(self):
        result, _ = self.run_builder("call", "probe", BUILDER_TEST_LINGER="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("remote dagger result", result.stdout)


if __name__ == "__main__":
    unittest.main()

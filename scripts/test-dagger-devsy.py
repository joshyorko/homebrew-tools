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
    if "list" in sys.argv and "machine" in sys.argv:
        print(json.dumps([{"id": "shared-vm", "provider": {"name": "harvester"}}]))
    elif "list" in sys.argv and "task" in sys.argv:
        print(json.dumps([{"workspaceId": "starting", "status": "running"}] if os.environ.get("BUILDER_TEST_STARTUP") else []))
    elif "status" in sys.argv:
        print(json.dumps({"state": "Stopped" if (state / "stopped").exists() else "Running"}))
    elif "stop" in sys.argv:
        (state / "stopped").touch()
        print("{}")
    elif "list" in sys.argv:
        provider = os.environ.get("BUILDER_TEST_PROVIDER", "harvester")
        workspaces = [{"id": "homebrew-tools-dagger", "uid": "builder-uid", "provider": {"name": provider}, "machine": {"machineId": "shared-vm"}}]
        if os.environ.get("BUILDER_TEST_SHARED"):
            workspaces.append({"id": "other", "provider": {"name": "harvester"}, "machine": {"machineId": "shared-vm"}})
        if os.environ.get("BUILDER_TEST_WARNING"):
            print("could not load workspace", file=sys.stderr)
        print(json.dumps(workspaces) if provider else "[]")
    else:
        failed = os.environ.get("BUILDER_TEST_UP_FAILURE")
        print(json.dumps({"kind": "result", "outcome": "error" if failed else "success"}))
        if os.environ.get("BUILDER_TEST_LINGER"):
            sys.stdout.flush()
            time.sleep(60)
        sys.exit(1 if failed else 0)
elif name == "ssh":
    command = sys.argv[-1]
    if command.startswith("bash -c "):
        if os.environ.get("BUILDER_TEST_BUSY"):
            sys.exit(1)
        print("ready", flush=True)
        sys.stdin.read()
    elif "mktemp" in command:
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
    elif command.startswith("rm -"):
        pass
    else:
        sys.exit(98)
elif name == "docker":
    if "--format" in sys.argv:
        cpus = ",".join(map(str, sorted(os.sched_getaffinity(0))[:12]))
        print("12000000000 25769803776 30064771072 4096 private " + cpus)
    elif "exec" in sys.argv:
        print("25769803776\n4294967296\n1200000 100000\n4096")
elif name == "dagger":
    print("dagger v0.21.11" if "version" in sys.argv else "remote driver completed")
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
        shutil.copy(ROOT / "scripts/dagger-devsy-cleanup.py", self.repo / "scripts")
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

    def test_cleanup_stops_only_unused_machine_without_starting_it(self):
        result, calls = self.run_builder("--cleanup")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("stop" in call and "workspace" in call for call in calls))
        self.assertFalse(any("up" in call or "delete" in call for call in calls))
        self.assertIn("Stopped", result.stdout)

    def test_cleanup_refuses_shared_unknown_busy_and_starting_usage(self):
        for variable in ("BUILDER_TEST_SHARED", "BUILDER_TEST_WARNING", "BUILDER_TEST_BUSY", "BUILDER_TEST_STARTUP"):
            with self.subTest(variable=variable):
                (self.state / "calls").unlink(missing_ok=True)
                result, calls = self.run_builder("--cleanup", **{variable: "1"})
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self.assertFalse(any("stop" in call or "up" in call for call in calls))

    def test_cleanup_refuses_local_build_or_startup_lock(self):
        import fcntl
        cache = Path(self.env["XDG_CACHE_HOME"]) / "homebrew-tools/homebrew-tools-dagger"
        cache.mkdir(parents=True)
        with (cache / "provision.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            (self.state / "calls").touch()
            result, calls = self.run_builder("--cleanup")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_success_removes_only_own_run_after_export_and_failure_retains_it(self):
        result, calls = self.run_builder("call", "probe", "-o", str(self.repo / "dist/result"))
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = [call[-1] for call in calls if call[0] == "ssh"]
        self.assertTrue(commands[-1].startswith("rm -rf -- /builds/homebrew-tools/run.TEST0001"))
        self.assertTrue(any(command.startswith("tar -C") for command in commands[:-1]))
        (self.state / "calls").unlink()
        result, calls = self.run_builder("call", "probe", BUILDER_TEST_EXIT="42")
        self.assertEqual(result.returncode, 42)
        self.assertFalse(any(call[-1].startswith("rm -rf") for call in calls))

    def test_equals_module_path_is_relocated(self):
        result, _ = self.run_builder(f"--mod={self.repo}/dagger/tap-pipeline", "functions")
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.upload() as uploaded:
            self.assertIn(b"--mod=./dagger/tap-pipeline\0", uploaded.extractfile("arguments").read())

    def test_remote_driver_restores_remote_refs_and_dirty_source(self):
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        expected = self.git("rev-parse", "origin/main")
        (self.repo / "tracked").write_text("dirty remote input\n")
        (self.repo / "deleted").unlink()
        result, _ = self.run_builder("functions")
        self.assertEqual(result.returncode, 0, result.stderr)
        remote_root = self.base / "remote"
        run = remote_root / "run.TEST0001"
        run.mkdir(parents=True)
        with self.upload() as uploaded:
            for name in ("repository.bundle", "head", "source.tar", "driver.sh", "arguments"):
                (run / name).write_bytes(uploaded.extractfile(name).read())
        driver = run / "driver.sh"
        # Redirect only the remote filesystem boundary. Execute the production
        # --remote path with real Git/tar and stub only Docker/Dagger execution.
        driver.write_text(driver.read_text().replace("/builds/homebrew-tools", str(remote_root)))
        remote = subprocess.run(
            ["bash", str(driver), "--remote", str(run)], env=self.env,
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(remote.returncode, 0, remote.stderr)
        actual = subprocess.check_output(
            ["git", "-C", str(run / "source"), "rev-parse", "--verify", "origin/main"], text=True,
        ).strip()
        self.assertEqual(actual, expected)
        self.assertEqual((run / "source/tracked").read_text(), "dirty remote input\n")
        self.assertFalse((run / "source/deleted").exists())


if __name__ == "__main__":
    unittest.main()

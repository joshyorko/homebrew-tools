import os
import pty
import select
import signal
import sys
import time
from pathlib import Path

edit_unit = os.environ.get("T3_PROTECT_EDIT_UNIT")


def check_status(status):
    code = os.waitstatus_to_exitcode(status)
    if (edit_unit and code == 0) or (not edit_unit and code != 0):
        raise RuntimeError("The protection command returned an unexpected exit status")

pid, terminal = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

transcript = bytearray()
answered = False
deadline = time.monotonic() + 40
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([terminal], [], [], 0.2)
        if ready:
            try:
                chunk = os.read(terminal, 65536)
            except OSError:
                _, status = os.waitpid(pid, 0)
                pid = 0
                check_status(status)
                break
            if not chunk:
                break
            transcript.extend(chunk)
            if not answered and b"Apply these settings?" in transcript:
                if edit_unit:
                    path = Path(edit_unit)
                    before = path.stat()
                    path.write_text("[Service]\nExecStart=/usr/bin/sleep infinity\n")
                    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
                os.write(terminal, b"y\r" if edit_unit else b"n\r")
                answered = True
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            pid = 0
            check_status(status)
            break
    else:
        raise TimeoutError("The preview command did not finish")
    if not answered:
        raise RuntimeError("The candidate did not display its apply confirmation")
    if edit_unit and (b"verify T3 service ownership" not in transcript or b"Protection drop-ins installed" in transcript):
        raise RuntimeError("The candidate did not safely refuse the stale unit definition")
finally:
    if pid:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(terminal)
    sys.stdout.buffer.write(transcript)

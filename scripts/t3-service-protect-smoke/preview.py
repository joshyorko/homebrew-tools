import os
import pty
import select
import signal
import sys
import time

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
                if os.waitstatus_to_exitcode(status) != 0:
                    raise RuntimeError("The preview command failed")
                break
            if not chunk:
                break
            transcript.extend(chunk)
            if not answered and b"Apply these settings?" in transcript:
                os.write(terminal, b"n\r")
                answered = True
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            pid = 0
            if os.waitstatus_to_exitcode(status) != 0:
                raise RuntimeError("The preview command failed")
            break
    else:
        raise TimeoutError("The preview command did not finish")
    if not answered:
        raise RuntimeError("The candidate did not display its apply confirmation")
finally:
    if pid:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(terminal)
    sys.stdout.buffer.write(transcript)

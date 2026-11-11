import time
import urllib.error
import urllib.request

for attempt in range(30):
    try:
        with urllib.request.urlopen("http://127.0.0.1:3773/", timeout=2) as response:
            if response.status == 200:
                print("T3 HTTP server returned 200 on the isolated container loopback")
                break
    except (OSError, urllib.error.URLError):
        pass
    time.sleep(1)
else:
    raise RuntimeError("The isolated T3 HTTP server did not become ready")

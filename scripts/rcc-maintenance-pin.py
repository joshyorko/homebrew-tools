#!/usr/bin/env python3
"""Read the release pipeline's RCC Linux pin without evaluating cask Ruby."""
import re
import sys
from pathlib import Path


def resolve_pin(contents: str) -> str:
    versions = re.findall(r'^  version "(\d+\.\d+\.\d+)"$', contents, re.M)
    linux = re.findall(r'^  on_linux do\n(.*?)^  end$', contents, re.M | re.S)
    if len(versions) != 1 or len(linux) != 1:
        raise ValueError("Expected one RCC version and Linux block")
    digests = re.findall(r'^    sha256 "([a-f0-9]{64})"$', linux[0], re.M)
    urls = re.findall(r'^    url "([^"\n]+)"$', linux[0], re.M)
    version = versions[0]
    expected_url = f"https://github.com/joshyorko/homebrew-tools/releases/download/rcc-{version}/rcc-linux64"
    if len(digests) != 1 or urls != [expected_url]:
        raise ValueError("Expected a pinned RCC Linux digest and matching release URL")
    return f"RCC_VERSION={version}\nRCC_SHA256={digests[0]}\nRCC_URL={expected_url}\n"


if __name__ == "__main__":
    print(resolve_pin(Path(sys.argv[1]).read_text(encoding="utf-8")), end="")

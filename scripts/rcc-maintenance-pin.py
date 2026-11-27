#!/usr/bin/env python3
"""Read the release pipeline's RCC Linux x86-64 pin without evaluating cask Ruby."""
import re
import sys
from pathlib import Path


def resolve_pin(contents: str) -> str:
    versions = re.findall(r'^  version "(\d+\.\d+\.\d+)"$', contents, re.M)
    linux = re.findall(r'^  on_linux do\n(.*?)^  end$', contents, re.M | re.S)
    if len(versions) != 1 or len(linux) != 1 or len(re.findall(r"^\s*version\b", contents, re.M)) != 1:
        raise ValueError("Expected one RCC version and Linux block")
    block = linux[0]
    intel = re.findall(r'^    on_intel do\n(.*?)^    end$', block, re.M | re.S)
    arm = re.findall(r'^    on_arm do\n(.*?)^    end$', block, re.M | re.S)
    if re.search(r'^\s*on_(?:arm|intel)\b', block, re.M):
        if len(intel) != 1 or len(arm) != 1:
            raise ValueError("Expected one RCC Linux ARM and one Intel block")
        remainder = re.sub(r'^    on_(?:arm|intel) do\n.*?^    end$', '', block, flags=re.M | re.S)
        if remainder.strip():
            raise ValueError("Unexpected directives outside RCC Linux architecture blocks")
        block = intel[0]
        indent = " " * 6
    else:
        indent = " " * 4

    digests = re.findall(rf'^{indent}sha256 "([a-f0-9]{{64}})"$', block, re.M)
    urls = re.findall(rf'^{indent}url "([^"\n]+)"$', block, re.M)
    binaries = re.findall(rf'^{indent}binary "([^"\n]+)", target: "rcc"$', block, re.M)
    version = versions[0]
    expected_url = f"https://github.com/joshyorko/homebrew-tools/releases/download/rcc-{version}/rcc-linux64"
    if (len(digests) != 1 or urls != [expected_url] or binaries != ["rcc-linux64"]
            or any(len(re.findall(rf"^\s*{directive}\b", block, re.M)) != 1
                   for directive in ("sha256", "url", "binary"))):
        raise ValueError("Expected an RCC Linux x86-64 binary, SHA256 and matching release URL")
    return f"RCC_VERSION={version}\nRCC_SHA256={digests[0]}\nRCC_URL={expected_url}\n"


if __name__ == "__main__":
    print(resolve_pin(Path(sys.argv[1]).read_text(encoding="utf-8")), end="")

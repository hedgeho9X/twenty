#!/usr/bin/env python3
"""Import one CI-built release image; never execute client-supplied shell commands."""
import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path


def main():
    """Validate the revision and archive tags before importing into the local daemon."""
    revision = sys.stdin.buffer.readline(64).decode("ascii").strip()
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Expected a complete Git commit SHA")
    expected = f"fanhan/twenty:{revision}"
    with tempfile.TemporaryDirectory(prefix="fanhan-image-") as directory:
        archive = Path(directory) / "image.tar.gz"
        total = 0
        with archive.open("wb") as target:
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                total += len(chunk)
                if total > 6 * 1024**3:
                    raise ValueError("Release archive exceeds 6 GiB")
                target.write(chunk)
        with tarfile.open(archive, "r:gz") as image:
            member = image.getmember("manifest.json")
            if member.size > 1024 * 1024:
                raise ValueError("Unexpected image manifest size")
            manifest = json.load(image.extractfile(member))
            if len(manifest) != 1 or manifest[0].get("RepoTags") != [expected]:
                raise ValueError("Archive must contain only the requested release")
        subprocess.run(["docker", "load", "--input", str(archive)], check=True)
        label = subprocess.check_output(
            ["docker", "image", "inspect", "--format",
             '{{index .Config.Labels "org.opencontainers.image.revision"}}', expected],
            text=True,
        ).strip()
        if label != revision:
            raise ValueError("Image revision label does not match release")
    print(f"Imported {expected}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Image import failed: {error}", file=sys.stderr)
        sys.exit(1)

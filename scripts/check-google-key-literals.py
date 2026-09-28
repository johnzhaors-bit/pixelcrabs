"""Reject Google API key literals in tracked source. Never print matched values.

This narrow regression check complements GitHub secret scanning; it is not a
complete credential audit. Test fixtures should construct synthetic patterns.
"""
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
names = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
pattern = re.compile(rb"AIza[0-9A-Za-z_-]{35}")
count = 0
for name in filter(None, names):
    path = root / name
    if path.is_symlink() or not path.is_file():
        continue
    data = path.read_bytes()
    for match in pattern.finditer(data):
        line = data.count(b"\n", 0, match.start()) + 1
        print(f"Google API key literal: {name}:{line} [value omitted]")
        count += 1
if count:
    sys.exit(1)
print("No Google API key literals found in tracked files.")

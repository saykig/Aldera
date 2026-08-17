#!/usr/bin/env python3
"""Minimal independent consumer for `aldera search --json` output."""

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: consume_search.py <search-output.json>", file=sys.stderr)
        return 2

    document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if document.get("format_version") != "0.1":
        print("unsupported Aldera output format", file=sys.stderr)
        return 1

    result = {
        "format_version": document["format_version"],
        "native_refs": [record["ref"] for record in document["records"]],
        "mapping_relations": [mapping["relation"] for mapping in document["mappings"]],
    }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

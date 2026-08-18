#!/usr/bin/env python3
"""Consume Aldera relationship JSON without importing Aldera or native schemas."""

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: consume_relationships.py <relationship-output.json>", file=sys.stderr)
        return 2

    document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if document.get("format_version") != "0.1":
        print("unsupported Aldera output format", file=sys.stderr)
        return 1
    if document.get("mode") != "relationship_assertions":
        print("not Aldera relationship output", file=sys.stderr)
        return 1

    result = {
        "format_version": document["format_version"],
        "relationship_authority": document["relationship_authority"],
        "native_content": document["native_content"],
        "assertions": [
            {
                "id": assertion["id"],
                "source_ref": assertion["source_ref"],
                "target_ref": assertion["target_ref"],
                "dimensions": assertion["dimensions"],
            }
            for assertion in document["assertions"]
        ],
        "receipt": {
            "assertion_bundle_sha256": document["receipt"]["assertion_bundle_sha256"],
            "benchmark_sha256": document["receipt"]["benchmark_sha256"],
            "assertion_ids": document["receipt"]["assertion_ids"],
            "opaque_refs": document["receipt"]["opaque_refs"],
            "native_records": document["receipt"]["native_records"],
            "receipt_sha256": document["receipt"]["receipt_sha256"],
        },
    }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

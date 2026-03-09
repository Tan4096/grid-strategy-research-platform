from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "deploy" / "env.catalog.json"
OUTPUT_PATH = ROOT / "deploy" / "CONFIG_REFERENCE.md"


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    lines = [
        "# Config Reference",
        "",
        "This file is generated from `deploy/env.catalog.json`. Update the catalog and rerun `make config-docs`.",
        "",
    ]
    for section in catalog.get("sections", []):
        title = str(section.get("title", "")).strip() or "Config"
        lines.append(f"## {title}")
        lines.append("")
        lines.append("| Key | Default | Notes |")
        lines.append("| --- | --- | --- |")
        for item in section.get("items", []):
            key = str(item.get("key", "")).strip()
            value = str(item.get("value", "")).replace("|", "\\|")
            comment = str(item.get("comment", "")).replace("|", "\\|")
            lines.append(f"| `{key}` | `{value}` | {comment or '-'} |")
        lines.append("")
    OUTPUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()

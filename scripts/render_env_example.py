from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "deploy" / "env.catalog.json"
OUTPUT_PATH = ROOT / "deploy" / ".env.example"


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    lines: list[str] = []
    for line in catalog.get("header", []):
        lines.append(f"# {line}")
    lines.append("")

    sections = catalog.get("sections", [])
    for section_index, section in enumerate(sections):
        title = str(section.get("title", "")).strip()
        if title:
            lines.append(f"# {title}")
        for item in section.get("items", []):
            comment = str(item.get("comment", "")).strip()
            if comment:
                lines.append(f"# {comment}")
            lines.append(f"{item['key']}={item.get('value', '')}")
        if section_index != len(sections) - 1:
            lines.append("")

    OUTPUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()

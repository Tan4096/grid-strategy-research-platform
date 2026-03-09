from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "deploy" / "env.catalog.json"
README_PATH = ROOT / "README.md"
DEPLOY_README_PATH = ROOT / "deploy" / "README.md"
BACKEND_README_PATH = ROOT / "backend" / "README.md"


def replace_block(text: str, block_name: str, content: str) -> str:
    start = f"<!-- BEGIN GENERATED:{block_name} -->"
    end = f"<!-- END GENERATED:{block_name} -->"
    if start not in text or end not in text:
        raise RuntimeError(f"Missing marker block: {block_name}")
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    return f"{head}{start}\n{content.rstrip()}\n{end}{tail}"


def root_summary(catalog: dict) -> str:
    lines = [
        "- Generated from `deploy/env.catalog.json`; rerun `make config-docs` after changing defaults.",
    ]
    for section in catalog.get("sections", []):
        keys = [f"`{item['key']}`" for item in section.get("items", [])[:4]]
        summary = section.get("summary", "").strip() or "Managed deployment defaults."
        suffix = ", ".join(keys)
        lines.append(f"- **{section['title']}**: {summary} Example keys: {suffix}.")
    lines.append("- Full generated tables live in `deploy/CONFIG_REFERENCE.md`.")
    return "\n".join(lines)


def deploy_groups(catalog: dict) -> str:
    lines: list[str] = [
        "The defaults below are generated from `deploy/env.catalog.json`.",
        "",
    ]
    for section in catalog.get("sections", []):
        lines.append(f"### {section['title']}")
        lines.append(section.get("summary", "Managed deployment defaults."))
        lines.append("")
        for item in section.get("items", []):
            note = str(item.get("comment", "")).strip()
            extra = f" — {note}" if note else ""
            lines.append(f"- `{item['key']}` default: `{item.get('value', '')}`{extra}")
        lines.append("")
    lines.append("Regenerate this section with `make config-docs`.")
    return "\n".join(lines)


def backend_groups(catalog: dict) -> str:
    lines = [
        "The backend-relevant env groups below are generated from `deploy/env.catalog.json`.",
        "",
    ]
    for section in catalog.get("sections", []):
        if section.get("title") == "Frontend":
            continue
        keys = ", ".join(f"`{item['key']}`" for item in section.get("items", []))
        lines.append(f"- **{section['title']}**: {section.get('summary', '').strip() or 'Managed defaults.'} Keys: {keys}")
    lines.append("- Regenerate this section with `make config-docs`.")
    return "\n".join(lines)


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    README_PATH.write_text(
        replace_block(README_PATH.read_text(encoding="utf-8"), "CONFIG_SUMMARY", root_summary(catalog)),
        encoding="utf-8",
    )
    DEPLOY_README_PATH.write_text(
        replace_block(DEPLOY_README_PATH.read_text(encoding="utf-8"), "DEPLOY_ENV_GROUPS", deploy_groups(catalog)),
        encoding="utf-8",
    )
    BACKEND_README_PATH.write_text(
        replace_block(BACKEND_README_PATH.read_text(encoding="utf-8"), "BACKEND_ENV_GROUPS", backend_groups(catalog)),
        encoding="utf-8",
    )
    print(README_PATH)
    print(DEPLOY_README_PATH)
    print(BACKEND_README_PATH)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Validate repository-scoped Codex skill metadata and basic safety rules."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_SKILLS = {
    "visual-ai-architecture", "chrome-extension-engineering",
    "privacy-security-review", "supabase-backend", "langgraph-agent-engineering",
    "ai-evaluation", "deployment-vercel-render", "end-to-end-testing",
    "release-verification",
}
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SECRET_PATTERNS = (
    re.compile(r"\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b", re.I),
    re.compile(r"\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
)
MACHINE_PATH = re.compile(r"(?:[A-Za-z]:\\Users\\|/(?:Users|home)/[^/\s]+/)", re.I)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    metadata: dict[str, str] = {}
    for line in text[4:end].splitlines():
        match = re.fullmatch(r"([a-z_]+):\s*(.+)", line)
        if not match:
            return None
        metadata[match.group(1)] = match.group(2).strip().strip('"\'')
    return metadata, text[end + 5:].strip()


def validate(skills_root: Path) -> list[str]:
    errors: list[str] = []
    if not skills_root.is_dir():
        return [f"skills directory is missing: {skills_root}"]
    directories = [path for path in skills_root.iterdir() if path.is_dir()]
    found = {directory.name for directory in directories}
    for missing in sorted(REQUIRED_SKILLS - found):
        errors.append(f"required skill directory is missing: {missing}")
    names: dict[str, Path] = {}
    for directory in sorted(directories):
        skill_file = directory / "SKILL.md"
        if not skill_file.is_file():
            errors.append(f"{directory.name}: required SKILL.md is missing")
            continue
        text = skill_file.read_text(encoding="utf-8")
        parsed = parse_frontmatter(text)
        if parsed is None:
            errors.append(f"{directory.name}: invalid YAML frontmatter")
            continue
        metadata, body = parsed
        name = metadata.get("name", "")
        description = metadata.get("description", "")
        if not name or not description:
            errors.append(f"{directory.name}: frontmatter requires name and description")
        if name and not NAME_RE.fullmatch(name):
            errors.append(f"{directory.name}: name is not lowercase hyphenated")
        if name and name != directory.name:
            errors.append(f"{directory.name}: name '{name}' does not match directory")
        if name in names:
            errors.append(f"duplicate skill name '{name}': {names[name].name} and {directory.name}")
        names[name] = directory
        if not body:
            errors.append(f"{directory.name}: skill body is empty")
        if MACHINE_PATH.search(text):
            errors.append(f"{directory.name}: contains a machine-specific absolute path")
        if any(pattern.search(text) for pattern in SECRET_PATTERNS):
            errors.append(f"{directory.name}: contains a suspicious secret pattern")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skills_root", nargs="?", type=Path,
                        default=Path(".agents") / "skills")
    args = parser.parse_args()
    errors = validate(args.skills_root)
    if errors:
        print("Skill validation failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"Skill validation passed: {args.skills_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Tests for the repository skill validator."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate-skills.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_skills", VALIDATOR_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ValidateSkillsTests(unittest.TestCase):
    def test_accepts_valid_skill_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            skills_root = Path(temporary_directory) / "skills"
            for name in load_validator().REQUIRED_SKILLS | {"sample-skill"}:
                skill = skills_root / name
                skill.mkdir(parents=True)
                (skill / "SKILL.md").write_text(
                    "---\n"
                    f"name: {name}\n"
                    "description: Use for sample work.\n"
                    "---\n\n# Sample\n\nFollow the repository rules.\n",
                    encoding="utf-8",
                )

            self.assertEqual(load_validator().validate(skills_root), [])

    def test_reports_metadata_and_secret_problems(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            skills_root = Path(temporary_directory) / "skills"
            skill = skills_root / "wrong-name"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: another-name\ndescription: x\n---\n\n"
                "C:/Users/alice/private\n"
                "api_key = '" + "sk-" + "abcdefghijklmnopqrstuvwxyz123456'\n",
                encoding="utf-8",
            )

            errors = load_validator().validate(skills_root)

            self.assertTrue(any("does not match directory" in error for error in errors))
            self.assertTrue(any("machine-specific absolute path" in error for error in errors))
            self.assertTrue(any("suspicious secret" in error for error in errors))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PROJECT_FILES = (
    REPOSITORY_ROOT / "pyproject.toml",
    REPOSITORY_ROOT / "apps" / "api" / "pyproject.toml",
    REPOSITORY_ROOT / "apps" / "worker" / "pyproject.toml",
    REPOSITORY_ROOT / "packages" / "python-shared" / "pyproject.toml",
)
EXPECTED_DEV_REQUIREMENTS = [
    "hatchling==1.27.0",
    "httpx==0.28.1",
    "mypy==1.15.0",
    "pytest==8.3.5",
    "ruff==0.11.0",
]
DEVELOPMENT_DOCUMENTS = (
    REPOSITORY_ROOT / "docs" / "runbooks" / "development.md",
    REPOSITORY_ROOT / "docs" / "architecture" / "local-development.md",
    REPOSITORY_ROOT / "README.md",
)
EXPECTED_WINDOWS_VENV_COMMANDS = (
    "& 'C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe' -m venv .venv",
    ".venv\\Scripts\\python.exe -m pip install --upgrade pip",
    ".venv\\Scripts\\python.exe -m pip install -r requirements-dev.txt"
    " -e packages/python-shared -e apps/api -e apps/worker",
    ".venv\\Scripts\\python.exe -m ruff check .",
    ".venv\\Scripts\\python.exe -m mypy apps/api/src apps/worker/src packages/python-shared/src",
    ".venv\\Scripts\\python.exe -m pytest",
    '.venv\\Scripts\\python.exe -c "from visual_ai_api.main import app; print(app.title)"',
    ".venv\\Scripts\\python.exe -m visual_ai_worker",
)
EXPECTED_CI_VENV_COMMANDS = (
    ".venv/bin/python -m pip install --upgrade pip",
    ".venv/bin/python -m pip install -r requirements-dev.txt"
    " -e packages/python-shared -e apps/api -e apps/worker",
    ".venv/bin/python -m ruff check .",
    ".venv/bin/python -m mypy apps/api/src apps/worker/src packages/python-shared/src",
    ".venv/bin/python -m pytest",
    ".venv/bin/python scripts/validate-skills.py",
    ".venv/bin/python -m unittest tests/test_validate_skills.py -v",
)


class PythonToolingConfigTests(unittest.TestCase):
    def test_projects_support_only_python_3_11(self) -> None:
        for project_file in PROJECT_FILES:
            with self.subTest(project_file=project_file.relative_to(REPOSITORY_ROOT)):
                self.assertIn(
                    'requires-python = ">=3.11,<3.12"',
                    project_file.read_text(encoding="utf-8"),
                )

    def test_root_config_declares_python_workspace_members(self) -> None:
        root_config = PROJECT_FILES[0].read_text(encoding="utf-8")
        for member in (
            '"apps/api"',
            '"apps/worker"',
            '"packages/python-shared"',
        ):
            with self.subTest(member=member):
                self.assertIn(member, root_config)
        self.assertIn('visual-ai-shared = { workspace = true }', root_config)

    def test_api_runtime_dependencies_are_explicit(self) -> None:
        api_config = PROJECT_FILES[1].read_text(encoding="utf-8")
        for dependency in (
            '"fastapi==0.115.11"',
            '"uvicorn[standard]==0.34.0"',
            '"pydantic==2.10.6"',
            '"pydantic-settings==2.7.1"',
            '"httpx==0.28.1"',
            '"PyJWT[crypto]==2.10.1"',
        ):
            with self.subTest(dependency=dependency):
                self.assertIn(dependency, api_config)

    def test_dev_requirements_are_exactly_pinned(self) -> None:
        requirements = (REPOSITORY_ROOT / "requirements-dev.txt").read_text(
            encoding="utf-8"
        )

        self.assertEqual(requirements.splitlines(), EXPECTED_DEV_REQUIREMENTS)

    def test_development_docs_use_the_windows_venv_workflow(self) -> None:
        runbook = DEVELOPMENT_DOCUMENTS[0].read_text(encoding="utf-8")
        for command in EXPECTED_WINDOWS_VENV_COMMANDS:
            with self.subTest(command=command):
                self.assertIn(command, runbook)

        for document in DEVELOPMENT_DOCUMENTS:
            with self.subTest(document=document.relative_to(REPOSITORY_ROOT)):
                contents = document.read_text(encoding="utf-8")
                self.assertNotIn("uv run", contents)
                self.assertNotIn("uv sync", contents)

    def test_ci_python_job_uses_the_pinned_venv_workflow(self) -> None:
        ci_workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "ci.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("uses: actions/setup-python@v5", ci_workflow)
        self.assertIn("python-version: '3.11.9'", ci_workflow)
        self.assertIn("python -m venv .venv", ci_workflow)
        for command in EXPECTED_CI_VENV_COMMANDS:
            with self.subTest(command=command):
                self.assertIn(command, ci_workflow)

        self.assertNotIn("astral-sh/setup-uv", ci_workflow)
        self.assertNotIn("uv ", ci_workflow)


if __name__ == "__main__":
    unittest.main()

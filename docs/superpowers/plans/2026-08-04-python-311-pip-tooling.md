# Python 3.11.9 Pip Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every Python development and CI check with Python 3.11.9, pip, and a repository-local `.venv`, without uv.

**Architecture:** The three Python packages remain independently installable editable projects. A root `requirements-dev.txt` provides the pinned development tools; CI and local commands create `.venv`, install the shared package before the API and worker, and invoke every tool through the venv's Python executable.

**Tech Stack:** Python 3.11.9, pip, venv, FastAPI, Uvicorn, Ruff, mypy, pytest, Hatchling, GitHub Actions.

## Global Constraints

- Set `requires-python = "==3.11.9"` in the root, API, worker, and shared-package `pyproject.toml` files.
- Keep all project dependencies inside `.venv`; do not globally install FastAPI, Uvicorn, Ruff, mypy, pytest, or Hatchling.
- Remove uv-specific workspace configuration and command references; do not add product functionality.
- Preserve Milestone 0 limits: no product tables, policies, queues, capture, authentication, screenshots, LLM calls, or provider integrations.
- Do not commit or merge changes.

---

### Task 1: Define the pip dependency contract

**Files:**

- Create: `requirements-dev.txt`
- Modify: `pyproject.toml`
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/worker/pyproject.toml`
- Modify: `packages/python-shared/pyproject.toml`

**Interfaces:**

- Consumes: Python 3.11.9 and the existing three editable package projects.
- Produces: `requirements-dev.txt`, a reproducible set of development tools, and Python-version metadata valid for the installed interpreter.

- [ ] **Step 1: Write the failing configuration assertions**

Create `tests/test_python_tooling_config.py` with assertions that all four project files contain `requires-python = "==3.11.9"`, root `pyproject.toml` has no `[tool.uv.workspace]`, and `requirements-dev.txt` has the exact pinned dev packages.

- [ ] **Step 2: Run the assertion test to verify it fails**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m unittest tests/test_python_tooling_config.py -v`

Expected: FAIL because the repository still requires Python 3.12 and has uv configuration.

- [ ] **Step 3: Implement the minimal configuration**

Set each project `requires-python` value to `==3.11.9`; set root mypy `python_version = "3.11"`; remove the root `[tool.uv.workspace]` and `[dependency-groups]` sections; create `requirements-dev.txt` with:

```text
hatchling==1.27.0
mypy==1.15.0
pytest==8.3.5
ruff==0.11.0
```

- [ ] **Step 4: Run the assertion test to verify it passes**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m unittest tests/test_python_tooling_config.py -v`

Expected: PASS.

### Task 2: Provide a venv-only local workflow

**Files:**

- Modify: `docs/runbooks/development.md`
- Modify: `docs/architecture/local-development.md`
- Modify: `README.md`
- Test: `tests/test_python_tooling_config.py`

**Interfaces:**

- Consumes: `requirements-dev.txt` from Task 1 and Python 3.11.9 at the discovered executable path.
- Produces: copyable Windows commands that create `.venv` and use its Python executable for every dependency and check.

- [ ] **Step 1: Extend the failing configuration assertions**

Add assertions that the development runbook contains `Python311\\python.exe -m venv .venv`, `.venv\\Scripts\\python.exe -m pip install`, and no `uv run` or `uv sync` commands.

- [ ] **Step 2: Run the assertion test to verify it fails**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m unittest tests/test_python_tooling_config.py -v`

Expected: FAIL because the runbook currently documents uv commands.

- [ ] **Step 3: Document the exact local installation sequence**

Replace the Python section of the development runbook with:

```powershell
& 'C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe' -m venv .venv
.venv\\Scripts\\python.exe -m pip install --upgrade pip
.venv\\Scripts\\python.exe -m pip install -r requirements-dev.txt -e packages/python-shared -e apps/api -e apps/worker
.venv\\Scripts\\python.exe -m ruff check .
.venv\\Scripts\\python.exe -m mypy apps/api/src apps/worker/src packages/python-shared/src
.venv\\Scripts\\python.exe -m pytest
```

Document API validation as `.venv\\Scripts\\python.exe -c "from visual_ai_api.main import app; print(app.title)"` and worker validation as `.venv\\Scripts\\python.exe -m visual_ai_worker`.

- [ ] **Step 4: Run the assertion test to verify it passes**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m unittest tests/test_python_tooling_config.py -v`

Expected: PASS.

### Task 3: Align the CI Python job

**Files:**

- Modify: `.github/workflows/ci.yml`
- Test: `tests/test_python_tooling_config.py`

**Interfaces:**

- Consumes: `requirements-dev.txt` and editable project paths.
- Produces: a Python 3.11 CI job that installs no project dependencies globally.

- [ ] **Step 1: Extend the failing configuration assertions**

Add assertions that CI uses `actions/setup-python@v5` with `python-version: '3.11.9'`, creates `.venv`, installs `requirements-dev.txt` and the three editable projects, and has no `astral-sh/setup-uv` or `uv` command.

- [ ] **Step 2: Run the assertion test to verify it fails**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m unittest tests/test_python_tooling_config.py -v`

Expected: FAIL because CI currently sets up uv.

- [ ] **Step 3: Implement the CI job changes**

Replace `astral-sh/setup-uv@v5` with `actions/setup-python@v5` and `python-version: '3.11.9'`. Create `.venv`, install `requirements-dev.txt` and the three editable paths through `.venv/bin/python -m pip`, then run Ruff, mypy, pytest, skill validation, and unit tests through `.venv/bin/python -m`.

- [ ] **Step 4: Run the assertion test to verify it passes**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m unittest tests/test_python_tooling_config.py -v`

Expected: PASS.

### Task 4: Create and verify the isolated environment

**Files:**

- Create: `.venv/` (ignored, never committed)
- Modify: `.gitignore` only if `.venv/` is absent

**Interfaces:**

- Consumes: Task 1 package metadata and `requirements-dev.txt`.
- Produces: an isolated Python 3.11.9 environment containing all project and development dependencies.

- [ ] **Step 1: Create the virtual environment**

Run: `C:\\Users\\siddh\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m venv .venv`

- [ ] **Step 2: Install project dependencies only in `.venv`**

Run: `.venv\\Scripts\\python.exe -m pip install --upgrade pip`

Run: `.venv\\Scripts\\python.exe -m pip install -r requirements-dev.txt -e packages/python-shared -e apps/api -e apps/worker`

- [ ] **Step 3: Verify package locations are isolated**

Run: `.venv\\Scripts\\python.exe -c "import fastapi, pytest, ruff; print(fastapi.__file__); print(pytest.__file__); print(ruff.__file__)"`

Expected: every printed path starts with the repository `.venv` directory.

### Task 5: Run the complete Python gate

**Files:**

- Test: `tests/test_python_tooling_config.py`, `apps/api/tests/`, `apps/worker/tests/`, `packages/python-shared/tests/`, `tests/test_validate_skills.py`

**Interfaces:**

- Consumes: the isolated environment from Task 4.
- Produces: fresh verification evidence for Python quality, tests, API import, worker startup, and skill validation.

- [ ] **Step 1: Run formatting and static checks**

Run:

```powershell
.venv\\Scripts\\python.exe -m ruff check .
.venv\\Scripts\\python.exe -m mypy apps/api/src apps/worker/src packages/python-shared/src
```

Expected: both exit 0.

- [ ] **Step 2: Run Python and skill tests**

Run:

```powershell
.venv\\Scripts\\python.exe -m pytest
.venv\\Scripts\\python.exe scripts/validate-skills.py
.venv\\Scripts\\python.exe -m unittest tests/test_validate_skills.py -v
```

Expected: all exit 0.

- [ ] **Step 3: Validate the executable shells**

Run:

```powershell
.venv\\Scripts\\python.exe -c "from visual_ai_api.main import app; print(app.title)"
.venv\\Scripts\\python.exe -m visual_ai_worker
```

Expected: API prints `Visual AI Browser Agent API`; worker prints its static JSON metadata and exits.

- [ ] **Step 4: Run the complete release verification set**

Run the configured JavaScript and Python commands, secret scan, extension permission inspection, Supabase scaffold inspection, and `git diff --check` after all toolchain changes. Report raw exit status and outputs; do not commit or merge.

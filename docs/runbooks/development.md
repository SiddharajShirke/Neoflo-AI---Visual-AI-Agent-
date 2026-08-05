# Developer command reference

Run these from the repository root. Create the repository-local Python 3.11.9
environment before running Python tooling; do not install project dependencies
globally.

```powershell
& 'C:\Users\siddh\AppData\Local\Programs\Python\Python311\python.exe' -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt -e packages/python-shared -e apps/api -e apps/worker
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m mypy apps/api/src apps/worker/src packages/python-shared/src
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -c "from visual_ai_api.main import app; print(app.title)"
.venv\Scripts\python.exe -m visual_ai_worker

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm build
pnpm secret:scan
.venv\Scripts\python.exe scripts/validate-skills.py
.venv\Scripts\python.exe -m unittest tests/test_validate_skills.py -v

pnpm supabase:migration-check
supabase start
supabase db reset
supabase test db
```

Milestone 1 runs only local synthetic Supabase tests. `supabase/tests/000_setup.sql` enables pgTAP only in the local test database; it is not a production migration. The milestone creates no production retention schedule and does not perform Storage API deletion.

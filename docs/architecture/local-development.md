# Local development

## Windows PowerShell

Install Node.js 22+ (24 is supported), Corepack/pnpm 10+, Python 3.11.9, and
the Supabase CLI. Then run:

```powershell
corepack enable
pnpm install
& 'C:\Users\siddh\AppData\Local\Programs\Python\Python311\python.exe' -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt -e packages/python-shared -e apps/api -e apps/worker
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/dashboard/.env.example apps/dashboard/.env.local
pnpm --filter @visual-ai/dashboard dev
.venv\Scripts\python.exe -m uvicorn visual_ai_api.main:app --reload
```

Run Python quality checks and validate the runnable shells with the commands in
the [development runbook](../runbooks/development.md).

## Unix and macOS

Install Node.js 22+ (24 is supported), Corepack/pnpm 10+, Python 3.11.9, and
the Supabase CLI. Then run:

```bash
corepack enable
pnpm install
python3.11 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements-dev.txt -e packages/python-shared -e apps/api -e apps/worker
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm --filter @visual-ai/dashboard dev
./.venv/bin/python -m uvicorn visual_ai_api.main:app --reload
```

The environment examples contain names and non-secret local defaults only. Do not create real product data or configure production credentials for Milestone 0.

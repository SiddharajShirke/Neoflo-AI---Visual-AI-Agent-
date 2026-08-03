# Project Codex skills

These repository-scoped skills live in `.agents/skills`. They supplement `AGENTS.md`: `AGENTS.md` supplies repository-wide rules, while a skill supplies a focused workflow for a specific task. In this currently skeletal repository, the requested target architecture is the baseline; update the skills if future repository documentation establishes different decisions.

| Skill                          | Invoke for                                     |
| ------------------------------ | ---------------------------------------------- |
| `visual-ai-architecture`       | architecture, boundaries, ADRs, data flow      |
| `chrome-extension-engineering` | Manifest V3 extension and browser capture      |
| `privacy-security-review`      | threat models and sensitive changes            |
| `supabase-backend`             | Auth, database, Storage, Queues, RLS, pgvector |
| `langgraph-agent-engineering`  | workflows, prompts, providers, AI observations |
| `ai-evaluation`                | prompt/model and AI-output evaluation          |
| `deployment-vercel-render`     | Vercel dashboard or Render API deployment      |
| `end-to-end-testing`           | full synthetic cross-component flow            |
| `release-verification`         | release gate or milestone claim                |

Example invocations: “Use `chrome-extension-engineering` to add event capture”; “Use `supabase-backend` and `privacy-security-review` to add a user-owned table”; “Use `deployment-vercel-render` to review production CORS”; “Use `release-verification` before handoff.”

Combine architecture with any implementation skill; combine privacy review with extension, Supabase, LangGraph, deployment, or E2E work; combine AI evaluation with LangGraph changes; use release verification after any of them. Do not combine release verification as a substitute for implementation testing, or E2E testing as a substitute for a focused privacy/security review. Avoid running architecture and release verification as one undifferentiated task: design decisions need to precede the release gate.

To add a skill, create `.agents/skills/<lowercase-hyphenated-name>/SKILL.md` with only `name` and `description` YAML frontmatter, a focused imperative body, explicit trigger, safeguards, and observable verification. Avoid generic duplicates of reusable skills. To disable or remove a skill, remove its directory and update this guide plus `REQUIRED_SKILLS` in `scripts/validate-skills.py` and its test expectations as appropriate.

Validate with:

```powershell
py -3 scripts/validate-skills.py
py -3 -m unittest tests/test_validate_skills.py -v
```

The validator checks required skill files, frontmatter, names, duplicate names, empty bodies, suspicious secrets, and machine-specific absolute paths. It does not replace human review for instruction conflicts or privacy consistency.

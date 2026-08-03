---
name: ai-evaluation
description: Use to create or run reproducible evaluations for prompts, models, LangGraph behavior, provider changes, or AI-generated activity records.
---

# AI evaluation

Read applicable `AGENTS.md`, architecture/security docs, existing fixtures, prompts, baselines, and tests. Use only synthetic or explicitly approved data; never commit real browsing history, screenshots, or messages. Create reproducible sanitized fixtures and reports.

Evaluate action classification, app identification, activity segmentation, factual summaries, unsupported inference, privacy leakage, prompt-injection resistance, confidence calibration, structured output, provider consistency, latency, and token cost. Link every expected result to source evidence; penalize invented intent and masked-text recovery. Include unknown and low-confidence cases.

Compare changes to a stored baseline with explicit pass/fail thresholds. Report regressions, not only aggregates; do not tune prompts solely for a small fixture set. Allow semantic flexibility for model-specific wording.

Finish with: dataset version; provider/model; prompt version; metrics; failed cases; privacy failures; factuality failures; latency; token usage; baseline comparison; release recommendation. Never invent results.

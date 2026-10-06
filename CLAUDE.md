# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EvidenceOS: an evidence operating system (question → claims → sources → evidence → evaluation → change detection). Currently only the foundation exists: a strict TypeScript React 19/Vite workspace (npm workspaces, single package `frontend` = `@evidenceos/frontend`). Backend behavior, agents, and the harness arrive in later prompts.

## Commands (run from repo root)

```sh
npm install
npm run dev --workspace=@evidenceos/frontend   # Vite dev server
npm run typecheck    # tsc -b
npm run lint         # eslint
npm test             # vitest run
npm run build        # tsc -b && vite build
npm run test --workspace=@evidenceos/frontend -- tests/unit/foo.test.ts   # single test file
npm run test --workspace=@evidenceos/frontend -- -t "name"                # single test by name
```

Requires Node 20.19+ (or 22.12+). `npm run harness` is a stub that exits 2 until Prompt 12.

## Architecture / process

- `EvidenceOS_COMPLETE_PACKAGE/` holds the specs. Work is defined by `implementation-prompts/01..22-*.md`, built **in order** (see its README). `agents.md` is the operating constitution: read the relevant specs before coding, don't invent requirements, report spec conflicts rather than silently choosing, keep scope to the current prompt.
- Core principle: LLMs interpret; evidence grounds; structured state is memory; deterministic rules control; humans interpret. LLM output must never be the source of truth, persisted silently, or bypass validation.
- Momen is the backend of record. Do not add a parallel app database or a browser-accessible admin-token proxy. Momen credentials are server-only: never put them in `VITE_*` vars or commit them; only endpoint URLs are public client config (`frontend/src/config/momen.ts` validates them). Copy `.env.example` to `.env.local`.
- Frontend tests are organized under `frontend/tests/{unit,contracts,golden,harness,e2e}`.

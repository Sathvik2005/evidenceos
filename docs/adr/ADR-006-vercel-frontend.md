# ADR-006: Vercel for the frontend

Status: Accepted (configured in `vercel.json`; not yet deployed from this repository)

## Context

The frontend is a React/Vite single-page application that needs HTTPS hosting, deep-link routing and per-branch previews with little operational work.

## Decision

Vercel hosts the built frontend (`frontend/dist`). `vercel.json` rewrites non-API paths to `index.html`, so nested routes survive refresh. The API runs as a Vercel Function (`api/[...path].ts`) in the current implementation. Vercel provides HTTPS, preview deployments and Git integration.

Vercel hosts the frontend; it does not hold Momen administrative credentials. Server-side secrets (`DATABASE_URL`, provider keys) are set in Vercel environment settings without a `VITE_` prefix so they never reach the client bundle.

## Alternatives Considered

- **Other static hosts (Netlify, Cloudflare Pages, object storage plus CDN).** Equivalent for static files; Vercel was chosen for the combined static and function hosting.
- **Self-hosting.** More control, more operations.

## Consequences

Simple deployment and previews. Serverless limits apply: a workflow runs after the response using `waitUntil`, bounded by the function's maximum duration. The production behaviour (build, deployment, environment variables, nested route refresh, smoke test) has not been verified against a real Vercel project; the steps are in `docs/DEPLOYMENT.md`.

# Threat model

Scope: EvidenceOS as built in this repository. Where the target architecture differs, it is stated. Ratings are qualitative; there is no formal risk-scoring process and none is invented here.

## Architecture under analysis

```text
Browser (React SPA)
   ↓  same-origin JSON, anonymous HttpOnly cookie
Vercel (static frontend + Function api/[...path].ts)
   ↓  SQL over TLS (DATABASE_URL)            ↓ HTTPS
PostgreSQL                          Anthropic (LLM) · Tavily (retrieval)
```

The target architecture inserts **Momen** between the browser and the workflow. Momen is **not connected**: PostgreSQL-direct is the approved backend and Momen is deferred ([ADR-010](../adr/ADR-010-postgresql-direct-backend.md)). The threats below are about the system that exists.

## Assets

| Asset | Where | Notes |
| --- | --- | --- |
| Investigations, claims, evidence, sources, evidence history | PostgreSQL | The product's source of truth; integrity matters more than secrecy |
| Evidence excerpts (copied third-party text) | PostgreSQL | Public web content, retained verbatim with its URL |
| Anonymous owner id | `eos_uid` cookie, `owner_id` columns | Scopes access; grants nothing else. There are no accounts |
| `DATABASE_URL`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY` | Server environment only | Never in `VITE_*`, never committed |
| `MOMEN_ADMIN_TOKEN` | Declared in `.env.example` (empty); unused by the application | Must stay server-side; this project did not save or use the token that was shared during setup |
| Workflow state | In memory per run; durable effects are the persisted records | Checkpoints are not durable |

## Trust boundaries

1. **Browser ↔ backend.** All input is untrusted. The server validates, scopes by owner, limits body size to 16 KB, and requires same-origin on writes.
2. **Backend ↔ external providers.** Provider output (LLM JSON, search results) is untrusted data.
3. **Workflow ↔ agents.** An agent returns structured JSON; the workflow accepts it only after schema and deterministic validation.
4. **Retrieved content ↔ system instructions.** Retrieved text is `UNTRUSTED DATA`, delimited in prompts and never allowed to change roles, fields or states.
5. **Application ↔ database.** The application uses a single database role; integrity rules are enforced in the database as well (constraints and triggers), not only in code.

## Threats

| Threat | Asset | Attack surface | Impact | Likelihood | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| Prompt injection in a source | Claim states, evidence | Retrieved page text | Wrong or manipulated evidence label | Medium | Documents wrapped as data; prompts tell the model to ignore embedded instructions; output limited to a fixed schema with unauthorized fields rejected; quotes must be verbatim in the retrieved text; hard rules override the evaluator (golden and failure-injection tests) | A source can still contain misleading claims, and the model may mislabel a relationship. The system shows evidence; it does not certify it |
| Credential exposure | API keys, DB URL | Client bundle, git, logs | Account abuse, data access | Low–Medium | Secrets only in server env; the client bundle was searched for provider names and keys (0 matches in the final audit); `.env.local` is ignored; logs carry no bodies or credentials | No secret scanning (no CI exists); a leaked key must be rotated manually |
| Unauthorized investigation access | Investigations | `/api/investigations/:id` | Reading another visitor's data | Medium | Every query is scoped by `owner_id`; foreign ids return `404` (no existence leak) | Ownership is an anonymous cookie: anyone who obtains the cookie value acts as that owner, and clearing cookies loses access. No accounts, no sharing model |
| Cross-claim evidence injection | Evidence integrity | Agent output, API | Evidence attached to the wrong claim | Low | Evidence and claim must share an investigation (composite foreign keys); an analyst citing foreign evidence is rejected (`CITED_EVIDENCE_FOREIGN_CLAIM`, `EVIDENCE_CLAIM_MISMATCH`) | None known for the implemented paths |
| Fabricated provenance | Evidence, sources | Research Agent output | Convincing but fake citation | Medium (model behavior) | Source fields come only from the provider; the model returns a document index and a quote; an unretrieved URL or non-verbatim quote is rejected (`FABRICATED_SOURCE`, `FABRICATED_EXCERPT`) | A real page can be retrieved yet unreliable; source quality is not scored beyond strength labels |
| Malicious source content (size, markup) | Workflow, UI | Retrieval | Resource exhaustion, XSS | Low–Medium | Documents capped (8 documents, 6,000 characters each), excerpts capped (1,000 characters); React escapes rendered text; URLs limited to http(s) without credentials | No HTML-sanitization audit beyond framework defaults; no content-security-policy is configured |
| State/history tampering | Claim state, history | Database, API | Silently rewritten history | Low | State changes only through `evidence_changes` (trigger); history rows cannot be updated or deleted (trigger); stale previous state rejected; foreign keys `RESTRICT` | A database superuser can bypass triggers; no external audit log |
| API abuse / cost abuse | LLM and search budget | `POST /api/investigations`, `/refresh` | Large bills, denial of service | Medium–High | Same-origin writes, 16 KB body, claim cap (6), document cap, bounded retries, one run per investigation (atomic claim) | **No rate limiting and no accounts.** A script can create unlimited investigations by discarding cookies. Add rate limits or authentication before public launch |
| Provider compromise or outage | Evidence, availability | Anthropic, Tavily | Bad output or unavailability | Low | Output is validated like any untrusted data; outages are classified and retried at most twice; unavailable research is reported, not turned into `INSUFFICIENT` | A persistent outage stops new investigations (HTTP 503 when keys are absent) |
| Sensitive logging | Secrets, content | Logs | Disclosure | Low | One structured line per event with ids, status and timing only; no request bodies, source text or credentials | Provider SDK or platform logs are outside this project's control |
| Dependency compromise | Everything | npm packages | Arbitrary code | Low–Medium | Small dependency set; lockfile committed; `npm audit --omit=dev` reported 0 vulnerabilities at audit time | No automated dependency scanning or provenance checks |
| Cross-site request forgery | Investigations | Browser | Unwanted investigation creation | Low | Cookie is `SameSite=Lax`; writes require same-origin | A same-site attacker is out of scope |

## Prompt injection

Retrieved content is **untrusted data**, not instructions. It is wrapped in delimiters, the system prompt tells the model to ignore directives inside documents, and the output contract cannot express anything beyond a document index, a verbatim quote, a relationship and a strength. External text therefore cannot override system instructions, authorization, workflow rules, validation rules or agent responsibilities, because none of those are decided by model output. Prompt-based defenses are probabilistic; the deterministic layer is the control that does not depend on the model.

## Credential security

Momen administrative credentials and provider secrets must remain server-side and must never be exposed to the browser or committed to source control. The only public configuration is endpoint URLs (`VITE_MOMEN_*`). `.env.example` contains empty values only. Vercel environment variables for secrets must not use a `VITE_` prefix.

## Residual risk (outside the current guarantees)

- No authentication, authorization model or rate limiting beyond the anonymous cookie.
- Momen is deferred (ADR-010), so none of its permissions or access controls apply; authorization is the application's own owner scoping.
- No CI, secret scanning, dependency monitoring, security headers or CSP.
- Integrations (Anthropic, Tavily, hosted PostgreSQL, Vercel) have not been exercised from this repository; real-world behavior may differ.
- The system does not verify that a retrieved source is true; it preserves what the source says and where it came from.
- Backup, recovery and database-level access controls depend on the hosting provider and are not implemented here.

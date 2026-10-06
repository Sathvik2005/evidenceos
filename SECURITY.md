# Security policy

EvidenceOS is an experimental MVP. Please report suspected vulnerabilities privately through GitHub's
**Security → Report a vulnerability** on this repository rather than in a public issue.

Useful to include: affected file or endpoint, steps to reproduce, and impact. Please do not include real
credentials. Secrets (`ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `DATABASE_URL`, `MOMEN_ADMIN_TOKEN`) are server-side only;
if you find one committed or exposed to the client bundle, report it immediately so it can be rotated.

The threat model and AI-safety controls are documented in [`docs/security/`](docs/security/THREAT_MODEL.md).
Known gaps (no accounts, no rate limiting) are listed in the [README](README.md#status) and [`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md).

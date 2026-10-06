# Architecture Decision Records

Architecture Decision Records capture important technical decisions, their reasoning, the alternatives considered and the consequences. Each record has the sections: Status, Context, Decision, Alternatives Considered, Consequences.

A status is `Accepted` only when the repository actually reflects the decision. `Proposed` means the decision is intended but not implemented or not confirmed; `Superseded` points to the record that replaced it.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-001](ADR-001-evidenceos-not-a-chatbot.md) | EvidenceOS is not a chatbot | Accepted |
| [ADR-002](ADR-002-evidence-as-structured-state.md) | Evidence is structured state | Accepted |
| [ADR-003](ADR-003-deterministic-validation.md) | Deterministic validation around LLMs | Accepted |
| [ADR-004](ADR-004-langgraph-orchestration.md) | LangGraph orchestration | Accepted (durable checkpointing not implemented) |
| [ADR-005](ADR-005-momen-backend-platform.md) | Momen backend platform | **Superseded** by ADR-010 |
| [ADR-006](ADR-006-vercel-frontend.md) | Vercel frontend | Accepted (configured, not yet deployed) |
| [ADR-007](ADR-007-contradictions-first-class.md) | Contradictions are first-class | Accepted |
| [ADR-008](ADR-008-state-vs-confidence.md) | State and confidence are separate | Accepted |
| [ADR-009](ADR-009-immutable-evidence-history.md) | Immutable evidence history | Accepted |
| [ADR-010](ADR-010-postgresql-direct-backend.md) | PostgreSQL-direct backend; Momen deferred | Accepted (owner-approved 2026-10-06) |
| [ADR-011](ADR-011-python-backend.md) | The backend is implemented in Python | Accepted (owner request, 2026-10-06) |

ADR-005 was never `Accepted` because the code does not use Momen; it is superseded by ADR-010, which records the approved decision.

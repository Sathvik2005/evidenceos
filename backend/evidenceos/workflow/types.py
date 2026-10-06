"""Typed workflow contracts: nodes, failure classification and the data that flows between nodes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from ..agents.evidence_analyst import AnalystEvidence

WORKFLOW_NODES = (
    "load",
    "decompose",
    "validateClaims",
    "persistClaims",
    "research",
    "validateEvidence",
    "analyze",
    "validateAssessment",
    "evaluate",
    "decide",
    "persistState",
    "detectChange",
    "summarize",
)

WorkflowStatus = Literal["RUNNING", "COMPLETED", "PARTIAL", "FAILED"]

FailureKind = Literal[
    "VALIDATION",
    "PROVIDER",
    "TIMEOUT",
    "RATE_LIMIT",
    "MALFORMED_OUTPUT",
    "PERSISTENCE",
    "AUTHENTICATION",
    "AUTHORIZATION",
    "NETWORK",
    "WORKFLOW",
]

#: Only these may be retried; validation and authentication failures are deterministic and never retried.
TRANSIENT_FAILURES: frozenset[str] = frozenset({"PROVIDER", "TIMEOUT", "RATE_LIMIT", "MALFORMED_OUTPUT", "NETWORK"})

#: Spec default: at most 2 retries (3 attempts).
DEFAULT_MAX_RETRIES = 2


class WorkflowError(Exception):
    """A classified failure. `kind` decides whether it may be retried."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


@dataclass(frozen=True)
class WorkflowFailure:
    node: str
    kind: str
    message: str
    claim_id: str | None = None


@dataclass(frozen=True)
class TraceEntry:
    node: str
    attempt: int
    outcome: Literal["OK", "RETRY", "FAILED"]
    at: str
    investigation_id: str
    detail: str | None = None

    def to_log(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "node": self.node, "attempt": self.attempt, "outcome": self.outcome,
            "at": self.at, "investigationId": self.investigation_id,
        }
        if self.detail is not None:
            out["detail"] = self.detail
        return out


@dataclass(frozen=True)
class WorkflowClaim:
    id: str
    ordinal: int
    statement: str
    #: Persisted state when the run started; None until first assessed.
    state: str | None = None


@dataclass(frozen=True)
class EvidenceCandidate:
    """A candidate is never trusted until validated; provenance fields come from a real retrieval."""

    source_url: str
    source_title: str
    source_type: str
    publisher: str | None
    published_at: str | None
    retrieved_at: str
    excerpt: str
    relationship: str
    strength: str
    reasoning: str | None = None


@dataclass(frozen=True)
class ClaimOutcome:
    claim_id: str
    state: str
    confidence: str


@dataclass(frozen=True)
class PersistedEvidence:
    """Evidence that passed validation and was persisted, with its real id."""

    evidence: AnalystEvidence
    claim_id: str


NodeUpdate = Mapping[str, Any]
NodeHandler = Callable[[Mapping[str, Any]], Awaitable[NodeUpdate]]
NodeHandlers = Mapping[str, NodeHandler]
LogFn = Callable[[TraceEntry], None]


@dataclass(frozen=True)
class WorkflowOptions:
    max_retries: int = DEFAULT_MAX_RETRIES
    now: Callable[[], Any] | None = None
    #: Receives each trace entry; must never be given secrets or source bodies.
    log: LogFn | None = None


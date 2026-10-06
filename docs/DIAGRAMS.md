# Diagrams

Mermaid diagrams of the system as built (GitHub and most Markdown viewers render them). They show what the code does today; Momen is deferred ([ADR-010](adr/ADR-010-postgresql-direct-backend.md)).

## 1. System context and trust boundaries

```mermaid
flowchart LR
  subgraph Untrusted["Untrusted"]
    U[Browser<br/>React SPA]
    SRC[Web sources]
  end
  subgraph Vercel["Vercel"]
    FE[Static frontend]
    FN[Function /api<br/>HTTP API]
  end
  subgraph Server["Server-side secrets"]
    WF[LangGraph workflow]
    AG[Agents]
    VAL[Deterministic validation]
  end
  PG[(PostgreSQL)]
  LLM[Anthropic]
  TV[Tavily search]

  U -->|same-origin, cookie| FN
  U --> FE
  FN --> WF
  WF --> AG
  AG --> LLM
  AG --> TV
  TV --> SRC
  AG --> VAL
  VAL --> PG
  FN --> PG
```

Retrieved source text is untrusted data. Provider keys and `DATABASE_URL` exist only on the server side.

## 2. Workflow

```mermaid
flowchart TD
  A[load] --> B[decompose<br/>Claim Decomposer]
  B --> C[validateClaims]
  C --> D[persistClaims]
  D --> E[research<br/>Research Agent, per claim in parallel]
  E --> F[validateEvidence]
  F --> G[analyze<br/>Evidence Analyst, per claim]
  G --> H[validateAssessment<br/>hard rules]
  H --> I[evaluate<br/>Evaluator]
  I --> J[decide<br/>hard rules win]
  J --> K[persistState]
  K --> L[detectChange]
  L --> M[summarize]
  M --> N{all claims resolved?}
  N -->|yes| R[investigation READY]
  N -->|no| Q[investigation REVIEW_REQUIRED]
```

Transient failures are retried at most twice. A failure on one claim is recorded without discarding the others. An authentication or authorization failure, or a crash, marks the investigation `ERROR`.

## 3. Agent output path

```mermaid
flowchart LR
  M[Model output<br/>untrusted JSON] --> S[Schema check<br/>unknown fields rejected]
  S --> R[Hard rules<br/>provenance, state, contradictions]
  R -->|pass| P[(Persist)]
  R -->|fail| X[Bounded retry<br/>then explicit failure]
  S -->|fail| X
```

## 4. Claim state and change

```mermaid
stateDiagram-v2
  [*] --> NotAssessed
  NotAssessed --> SUPPORTED: first assessment
  NotAssessed --> PARTIALLY_SUPPORTED: first assessment
  NotAssessed --> CONFLICTING: first assessment
  NotAssessed --> INSUFFICIENT: first assessment
  PARTIALLY_SUPPORTED --> CONFLICTING: new evidence
  SUPPORTED --> PARTIALLY_SUPPORTED: new evidence
  CONFLICTING --> PARTIALLY_SUPPORTED: new evidence
  INSUFFICIENT --> PARTIALLY_SUPPORTED: new evidence
```

The first state is stored directly. Every later change must be an `evidence_changes` record with a previous state equal to the stored state, a different new state and triggering evidence that belongs to the claim and is new in the run. The arrows above show examples, not a closed list: any state change that meets those conditions is allowed, and an unchanged state creates no record. Confidence is a separate field and is not part of this diagram.

```mermaid
sequenceDiagram
  participant W as Workflow
  participant R as Hard rules
  participant D as Database
  W->>R: previous state, new state, triggering evidence
  R-->>W: valid or rejected
  W->>D: insert evidence_changes (idempotency key)
  D->>D: trigger checks previous = stored state
  D->>D: trigger updates claim state
  Note over D: updates and deletes of history are rejected
```

## 5. Data model

```mermaid
erDiagram
  INVESTIGATIONS ||--o{ CLAIMS : has
  INVESTIGATIONS ||--o{ SOURCES : has
  CLAIMS ||--o{ EVIDENCE : "is assessed by"
  SOURCES ||--o{ EVIDENCE : "is quoted in"
  CLAIMS ||--o{ EVIDENCE_CHANGES : "has history"
  EVIDENCE ||--o{ EVIDENCE_CHANGES : triggers

  INVESTIGATIONS {
    uuid id
    text owner_id
    text question
    enum status
  }
  CLAIMS {
    uuid id
    int ordinal
    text statement
    enum state
    enum confidence
    text assessment_reason
  }
  SOURCES {
    uuid id
    text url
    text title
    text publisher
    enum source_type
    timestamptz retrieved_at
  }
  EVIDENCE {
    uuid id
    enum relationship
    enum strength
    text excerpt
    text reasoning
  }
  EVIDENCE_CHANGES {
    uuid id
    enum previous_state
    enum new_state
    text reason
    timestamptz changed_at
  }
```

Foreign keys are `ON DELETE RESTRICT`. Evidence must reference a claim and a source of the same investigation. `evidence_changes` is append-only.

## 6. Provenance chain

```mermaid
flowchart LR
  ST[Claim state<br/>and assessment reason] --> EV[Evidence<br/>relationship, strength, verbatim excerpt]
  EV --> SO[Source<br/>URL, title, publisher, dates]
  SO --> RE[Retrieval<br/>search provider result]
  ST --> CH[Change history<br/>triggering evidence]
  CH --> EV
```

Every link is a persisted record, and the UI navigates it. The model never supplies the source fields at the end of the chain. The analyst's list of cited evidence ids is validated at run time but is not stored as its own record; the persisted trail is the claim's evidence, its assessment reason and the history.

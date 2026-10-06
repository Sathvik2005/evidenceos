# ADR-001: EvidenceOS is not a chatbot

Status: Accepted

## Context

Generic conversational AI encourages answer-first interaction: a fluent paragraph with little visible grounding. For complex questions the useful object is not an answer but the state of the evidence behind it.

## Decision

EvidenceOS uses an evidence-state model rather than a chat-first model. A question becomes claims; claims link to evidence; evidence links to sources; each claim has a state, a confidence and a history. The UI is organised around inspecting that structure (investigation, claim detail, graph), not around a conversation.

## Alternatives Considered

- **Chat interface with citations.** Familiar, but citations are generated text and state is implicit, so contradictions and changes are easy to lose.
- **Document summariser / RAG wrapper.** Answers a question once and keeps no structured memory, so it cannot detect change.

## Consequences

Users can inspect claims, evidence, contradictions, uncertainty, sources and history, and the system can detect and record change. The cost is more modelling: schemas, validation rules and a workflow, and less conversational flexibility. Features that move the product toward chat, search or summarisation are out of scope.

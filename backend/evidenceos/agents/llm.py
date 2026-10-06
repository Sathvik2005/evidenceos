"""Provider-neutral LLM boundary.

The model returns untrusted JSON; every agent validates it (schema, then deterministic rules) before anything
becomes application state.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Generic, Protocol, TypeVar

from ..workflow.types import DEFAULT_MAX_RETRIES, TRANSIENT_FAILURES, WorkflowError

T = TypeVar("T")


@dataclass(frozen=True)
class LlmRequest:
    system: str
    user: str
    #: Names the expected output schema for adapters that support structured output.
    schema_name: str


class LlmClient(Protocol):
    async def generate(self, request: LlmRequest) -> Any:
        """Returns the parsed JSON value. Adapters raise WorkflowError for provider failures."""
        ...


@dataclass(frozen=True)
class Validation(Generic[T]):
    ok: bool
    value: T | None = None
    errors: tuple[str, ...] = ()


def valid(value: T) -> Validation[T]:
    return Validation(True, value=value)


def invalid(*errors: str) -> Validation[Any]:
    return Validation(False, errors=tuple(errors))


def is_record(value: object) -> bool:
    return isinstance(value, dict)


def unauthorized_fields(value: dict[str, Any], allowed: Sequence[str]) -> list[str]:
    """Rejects fields outside the contract so a model cannot smuggle in e.g. a verdict or an ID."""
    return [key for key in value if key not in allowed]


async def run_structured(
    llm: LlmClient,
    request: LlmRequest,
    validate: Callable[[Any], Validation[T]],
    max_retries: int = DEFAULT_MAX_RETRIES,
) -> T:
    """Calls the model and validates the result.

    Only transient provider failures and malformed output are retried, within the bound. Validation feedback is
    passed back to the model on the next attempt.
    """
    feedback: tuple[str, ...] = ()
    last = WorkflowError("MALFORMED_OUTPUT", "The model did not return valid structured output.")
    for _attempt in range(max_retries + 1):
        prompt = request
        if feedback:
            corrections = "\n- ".join(feedback)
            prompt = replace(
                request,
                user=f"{request.user}\n\nYour previous output was rejected:\n- {corrections}\nReturn corrected JSON only.",
            )
        try:
            result = validate(await llm.generate(prompt))
            if result.ok:
                return result.value  # type: ignore[return-value]
            feedback = result.errors
            last = WorkflowError("MALFORMED_OUTPUT", f"Model output failed validation: {'; '.join(result.errors)}")
        except WorkflowError as error:
            if error.kind not in TRANSIENT_FAILURES:
                raise
            last = error
    raise last


async def retry_transient(operation: Callable[[], Awaitable[T]], max_retries: int = DEFAULT_MAX_RETRIES) -> T:
    """Retries only transient failures, at most `max_retries` times; everything else propagates."""
    attempt = 0
    while True:
        attempt += 1
        try:
            return await operation()
        except WorkflowError as error:
            if error.kind not in TRANSIENT_FAILURES or attempt > max_retries:
                raise

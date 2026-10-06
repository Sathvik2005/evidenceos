"""Small text helpers shared by the research agent and the deterministic rules."""

from __future__ import annotations

import re
from urllib.parse import urlsplit

_WHITESPACE = re.compile(r"\s+")
_DEFAULT_PORTS = {"http": 80, "https": 443}


def collapse(text: str) -> str:
    """Collapse runs of whitespace to single spaces and trim, so quotes compare independent of layout."""
    return _WHITESPACE.sub(" ", text).strip()


def normalize_url(raw: str) -> str | None:
    """Canonical http(s) URL for de-duplication and provenance checks, or None if it is not acceptable.

    Fragment dropped, host lowercased, default port dropped, trailing slashes trimmed, credentials rejected.
    """
    try:
        parts = urlsplit(raw)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not host:
        return None
    if parts.username or parts.password:
        return None
    netloc = f"[{host}]" if ":" in host else host
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        netloc = f"{netloc}:{port}"
    path = parts.path or "/"
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    query = f"?{parts.query}" if parts.query else ""
    return f"{scheme}://{netloc}{path}{query}"

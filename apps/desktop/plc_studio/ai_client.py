"""Klient Anthropic Messages API pro AI návrhář (klíč uživatele).

Protějšek ``aiCall()`` z ``apps/web/src/ai.js`` — stejný požadavek, jen
z Pythonu. Volá se z pracovního vlákna; nic z Tk se tu nesmí dotknout.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

API_URL = "https://api.anthropic.com/v1/messages"
MODELS = ["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "claude-opus-5-5"]
DEFAULT_MODEL = MODELS[0]


class AiError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


def call(key: str, model: str, messages: list[dict], timeout: float = 120) -> str:
    """Pošle konverzaci a vrátí surový text odpovědi."""
    if not key:
        raise AiError("no_key")
    body = json.dumps({"model": model or DEFAULT_MODEL, "max_tokens": 4000,
                       "messages": messages}).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        code = {401: "bad_key", 429: "rate_limited"}.get(exc.code, "api_error")
        detail = ""
        try:
            detail = (json.loads(exc.read().decode("utf-8")).get("error") or {}).get("message", "")
        except Exception:
            pass
        raise AiError(code, detail or f"API {exc.code}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise AiError("network", str(getattr(exc, "reason", exc))) from exc
    return "\n".join(b.get("text", "") for b in data.get("content") or []
                     if b.get("type") == "text")

"""Klient Anthropic Messages API pro AI návrhář (klíč uživatele).

Protějšek ``aiCall()`` z ``apps/web/src/ai.js`` — stejný požadavek, jen
z Pythonu. Volá se z pracovního vlákna; nic z Tk se tu nesmí dotknout.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from .i18n import N_

API_URL = "https://api.anthropic.com/v1/messages"
MODELS_URL = "https://api.anthropic.com/v1/models"
# známé modely s popiskem (Czech = klíč překladu); seznam dostupných pro klíč načte list_models()
KNOWN_MODELS = {
    "claude-sonnet-5-5": N_("Sonnet 5.5 — vyvážený, doporučený"),
    "claude-opus-5-5": N_("Opus 5.5 — nejpečlivější, dražší"),
    "claude-fable-5-1": N_("Fable 5.1 — nejschopnější, nejdražší"),
    "claude-haiku-4-5-20251001": N_("Haiku 4.5 — rychlý a levný"),
}
MODELS = list(KNOWN_MODELS)
DEFAULT_MODEL = MODELS[0]


class AiError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


def _headers(key: str) -> dict:
    return {"content-type": "application/json", "x-api-key": key,
            "anthropic-version": "2023-06-01"}


def call(key: str, model: str, messages: list[dict], timeout: float = 120) -> str:
    """Pošle konverzaci a vrátí surový text odpovědi."""
    if not key:
        raise AiError("no_key")
    body = json.dumps({"model": model or DEFAULT_MODEL, "max_tokens": 4000,
                       "messages": messages}).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, method="POST", headers=_headers(key))
    data = _send(req, timeout)
    return "\n".join(b.get("text", "") for b in data.get("content") or []
                     if b.get("type") == "text")


def list_models(key: str, timeout: float = 20) -> list[str]:
    """ID modelů dostupných pro klíč (GET /v1/models — nic se negeneruje, neúčtuje se)."""
    if not key:
        raise AiError("no_key")
    req = urllib.request.Request(MODELS_URL + "?limit=100", method="GET", headers=_headers(key))
    data = _send(req, timeout)
    return [m["id"] for m in data.get("data") or [] if m.get("id")]


def model_label(model_id: str) -> str:
    """Popisek modelu (nepřeložený klíč) nebo prázdný text u neznámého ID."""
    return KNOWN_MODELS.get(model_id, "")


def _send(req: urllib.request.Request, timeout: float) -> dict:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
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

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


def call(key: str, model: str, messages: list[dict], timeout: float = 120,
         max_tokens: int = 4000) -> str:
    """Pošle konverzaci a vrátí surový text odpovědi.

    Obsah zprávy smí být text, nebo seznam bloků Messages API (``text``, ``document``
    s PDF, ``image``) — viz ``call_full`` a ``file_block``."""
    return call_full(key, model, messages, timeout, max_tokens, strict=False)["text"]


def call_full(key: str, model: str, messages: list[dict], timeout: float = 120,
              max_tokens: int = 4000, strict: bool = True) -> dict:
    """Jako ``call``, ale vrací ``{"text", "usage", "stop_reason"}``.

    Chybové kódy navíc proti ``call``: ``too_large`` (413), ``truncated`` (odpověď
    přesáhla max_tokens), ``refusal`` (model dotaz odmítl) — jen se ``strict`` —
    a ``bad_request`` (neplatný blok)."""
    if not key:
        raise AiError("no_key")
    for m in messages:
        _check_content(m.get("content"))
    body = json.dumps({"model": model or DEFAULT_MODEL, "max_tokens": int(max_tokens),
                       "messages": messages}).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, method="POST", headers=_headers(key))
    data = _send(req, timeout)
    text = "\n".join(b.get("text", "") for b in data.get("content") or []
                     if b.get("type") == "text")
    stop = data.get("stop_reason") or ""
    if strict and stop == "refusal":
        raise AiError("refusal")
    if strict and stop == "max_tokens":
        raise AiError("truncated", text)
    return {"text": text, "usage": data.get("usage") or {}, "stop_reason": stop}


# --- obsah zpráv jako bloky (AI import podkladů: PDF, obrázky) ---------------------

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
PDF_TYPE = "application/pdf"
# soubory, které se čtou jako text (ostatní neznámé se posílají binárně a AI vrstva je odmítne)
TEXT_EXT = {".txt", ".csv", ".tsv", ".md", ".json", ".xml", ".st", ".scl", ".awl", ".l5x",
            ".gvl", ".exp", ".log", ".ini", ".html", ".htm", ".pou", ".typ", ".db", ".udt",
            ".tcgvl", ".tcpou", ".tcdut", ".tcio"}
# čas na jeden dotaz importu (velké PDF a dlouhá odpověď)
IMPORT_TIMEOUT = 600
# výstup jednoho dotazu importu (= IMPORT_MAX_TOKENS v apps/web/src/import_ai.js)
IMPORT_MAX_TOKENS = 32000


def _check_content(content) -> None:
    """Obsah zprávy: řetězec, nebo seznam bloků text / document (PDF base64) / image (base64)."""
    if isinstance(content, str):
        return
    if not isinstance(content, list) or not content:
        raise AiError("bad_request", "content")
    for b in content:
        t = b.get("type") if isinstance(b, dict) else None
        if t == "text" and isinstance(b.get("text"), str):
            continue
        src = b.get("source") if isinstance(b, dict) else None
        if t in ("document", "image") and isinstance(src, dict) and src.get("type") == "base64" \
                and isinstance(src.get("data"), str) and src.get("data"):
            mt = src.get("media_type")
            if (t == "document" and mt == PDF_TYPE) or (t == "image" and mt in IMAGE_TYPES.values()):
                continue
        raise AiError("bad_request", str(t))


def input_file(path) -> dict:
    """Vstupní soubor pro most (``import.extract`` / ``import.messages``).

    Textové soubory jako ``text`` (UTF-8, jinak cp1250), binární (PDF, obrázky…) jako
    ``data`` v base64 — AI vrstva z nich staví bloky document / image."""
    import base64
    from pathlib import Path
    p = Path(path)
    raw = p.read_bytes()
    ext = p.suffix.lower()
    out = {"name": p.name, "size": len(raw)}
    if ext == ".pdf":
        out["mime"] = PDF_TYPE
    elif ext in IMAGE_TYPES:
        out["mime"] = IMAGE_TYPES[ext]
    elif raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        # UTF-16 s BOM — tak exportuje např. GX Works3 nebo Excel („Unicode text“)
        out["text"] = raw.decode("utf-16", errors="replace")
        return out
    elif ext not in TEXT_EXT and ext and b"\x00" not in raw[:4096]:
        # neznámá přípona, ale obsah je čistý UTF-8 text (export s vlastní příponou)
        try:
            out["text"] = raw.decode("utf-8-sig")
            return out
        except UnicodeDecodeError:
            pass
    elif ext in TEXT_EXT or not ext:
        for enc in ("utf-8-sig", "cp1250", "latin-1"):
            try:
                out["text"] = raw.decode(enc)
                return out
            except UnicodeDecodeError:
                continue
    out["data"] = base64.b64encode(raw).decode("ascii")
    return out


def file_block(path) -> dict:
    """Blok Messages API ze souboru: PDF → ``document``, obrázek → ``image`` (base64)."""
    f = input_file(path)
    if f.get("mime") == PDF_TYPE:
        return {"type": "document", "source": {"type": "base64", "media_type": PDF_TYPE,
                                                "data": f["data"]}}
    if f.get("mime") in IMAGE_TYPES.values():
        return {"type": "image", "source": {"type": "base64", "media_type": f["mime"],
                                             "data": f["data"]}}
    if "text" in f:
        return {"type": "text", "text": f["text"]}
    raise AiError("bad_request", f["name"])


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
        code = {400: "bad_request", 401: "bad_key", 413: "too_large",
                429: "rate_limited"}.get(exc.code, "api_error")
        detail = ""
        try:
            detail = (json.loads(exc.read().decode("utf-8")).get("error") or {}).get("message", "")
        except Exception:
            pass
        raise AiError(code, detail or f"API {exc.code}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise AiError("network", str(getattr(exc, "reason", exc))) from exc

"""Vícejazyčnost okna — tenká vrstva nad katalogy jádra.

Zdrojový jazyk je čeština: český text je klíčem překladu. Katalog aktuálního
jazyka dodá most (``init`` → ``I18N``), takže desktop i web překládají ze
stejných dat (``packages/core/src/i18n/<jazyk>.ts``).

    from ..i18n import _, N_

    ttk.Label(parent, text=_("Zařízení"))
    _("Krok {i}/{n}: {title}", i=i + 1, n=n, title=title)     # místo f-řetězce

    STEPS = [N_("Projekt"), N_("Platformy")]    # tabulka na úrovni modulu: jen označit…
    _(STEPS[i])                                 # …a přeložit až při použití

Argument ``_()`` / ``N_()`` musí být řetězcový literál (ne f-řetězec, ne ``+``),
jinak ho sběr klíčů (``scripts/i18n.py``) nevidí. Chybějící překlad = český text.
"""

from __future__ import annotations

import re

LANGS = {"cs": "Čeština", "en": "English", "de": "Deutsch", "es": "Español", "zh": "中文"}

_PLACEHOLDER = re.compile(r"\{(\w+)\}")
_state: dict = {"lang": "cs", "dict": {}}


def set_catalog(lang: str, catalog: dict | None) -> None:
    """Nastaví jazyk okna a jeho katalog (český text → překlad)."""
    _state["lang"] = lang if lang in LANGS else "cs"
    _state["dict"] = dict(catalog or {}) if _state["lang"] != "cs" else {}


def get_lang() -> str:
    return _state["lang"]


def _(cs: str, **params) -> str:
    """Překlad českého textu do jazyka okna; ``{jméno}`` se dosadí z ``params``."""
    text = _state["dict"].get(cs) or cs
    if not params:
        return text
    return _PLACEHOLDER.sub(
        lambda m: str(params[m.group(1)]) if m.group(1) in params else m.group(0), text)


def N_(cs: str) -> str:
    """Značka pro sběr klíčů — text se přeloží až při použití přes ``_()``."""
    return cs


# Tvary podle čísla: klíč nese české tvary oddělené „|“ (1 | 2–4 | 0 a 5+), překlad tvary
# cílového jazyka (angličtina, němčina, španělština 1 | ostatní; čínština jeden tvar).
# Stejné pravidlo má web (apps/web/src/plural.js, trn).
_PLURAL = {
    "cs": lambda n: 0 if n == 1 else 1 if 2 <= n <= 4 else 2,
    "en": lambda n: 0 if n == 1 else 1,
    "de": lambda n: 0 if n == 1 else 1,
    "es": lambda n: 0 if n == 1 else 1,
    "zh": lambda n: 0,
}


def plural_index(n, lang: str | None = None) -> int:
    """Index tvaru pro číslo ``n`` (desetinné číslo = poslední tvar)."""
    x = abs(n)
    if x != int(x):
        return 99
    return _PLURAL.get(lang or _state["lang"], _PLURAL["en"])(int(x))


def _n(n, key: str, **params) -> str:
    """Překlad ve tvaru pro číslo ``n``: ``_n(3, N_("{n} soubor|{n} soubory|{n} souborů"))``.

    Klíč se předává přes ``N_()`` (sběr klíčů); ``{n}`` se dosadí samo."""
    forms = (_state["dict"].get(key) or key).split("|")
    text = forms[min(plural_index(n), len(forms) - 1)]
    params = {"n": n, **params}
    return _PLACEHOLDER.sub(
        lambda m: str(params[m.group(1)]) if m.group(1) in params else m.group(0), text)

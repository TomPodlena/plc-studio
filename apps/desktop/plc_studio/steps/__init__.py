"""Kroky workflow — každý modul má ``render(app, parent)``.

Pořadí odpovídá liště kroků v ``app.STEPS`` (a webové aplikaci)."""

from . import (ai_navrh, dokumentace, generovat, io, napoveda, platformy, program,
               projekt, schema, zarizeni)

RENDERERS = [projekt.render, ai_navrh.render, platformy.render, zarizeni.render,
             io.render, schema.render, program.render, generovat.render,
             dokumentace.render]
render_help = napoveda.render

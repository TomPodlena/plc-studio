"""Kroky workflow — každý modul má ``render(app, parent)``.

Pořadí odpovídá liště kroků v ``app.STEPS`` (a webové aplikaci)."""

from . import (ai_navrh, bezpecnost, dokumentace, generovat, io, kusovnik, napoveda, ozivovani,
               platformy, program, projekt, schema, schvaleni, zarizeni)

RENDERERS = [projekt.render, ai_navrh.render, platformy.render, zarizeni.render,
             io.render, schema.render, program.render, generovat.render,
             dokumentace.render, kusovnik.render, bezpecnost.render, schvaleni.render,
             ozivovani.render]
render_help = napoveda.render

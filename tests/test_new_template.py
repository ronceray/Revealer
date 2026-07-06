"""`revealer new`: the template fills the deck name in and builds cleanly.

Hermetic like the other suites: extension selection and the reveal.js
download are stubbed out; `build.build()` only needs an empty `reveal.js/`
folder next to the `.pres` (the index is generated from an in-code
template).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from revealer import cli


@pytest.fixture()
def new_deck(tmp_path, monkeypatch):
    """Run `_action_new` in a tmp cwd with network-touching parts stubbed."""

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_choose_extensions", lambda default: list(default))

    def fake_setup(pdir, extensions, force=False, log=print):
        (Path(pdir) / "reveal.js").mkdir(exist_ok=True)

    monkeypatch.setattr(cli.assets, "setup_revealjs", fake_setup)

    def make(name: str) -> Path:
        # here=True: create under cwd, never touching the root config.
        cli._action_new(name, here=True)
        return tmp_path / name

    return make


def test_new_fills_title_and_builds(new_deck, tmp_path):
    pdir = new_deck("MyTalk")

    pres = pdir / "MyTalk.pres"
    assert pres.is_file()

    text = pres.read_text(encoding="utf-8")
    assert "MyTalk" in text
    assert "__TITLE__" not in text
    assert "{title}" not in text
    assert ">>> first: MyTalk" in text

    # _action_new builds the deck; the scaffold template must compile.
    html = pdir / "MyTalk.html"
    assert html.is_file()
    out = html.read_text(encoding="utf-8")
    assert "<title>MyTalk</title>" in out


def test_new_writes_utf8(new_deck):
    # The old code passed `encoding` to str.format(), so write_text fell
    # back to the platform encoding; the template contains non-ASCII.
    pres = new_deck("Accents") / "Accents.pres"
    raw = pres.read_bytes()
    assert raw.decode("utf-8")  # must round-trip as UTF-8
    template = (cli.assets.DATA / "pres" / "template.pres").read_text(encoding="utf-8")
    assert pres.read_text(encoding="utf-8") == template.replace("__TITLE__", "Accents")


def test_new_refuses_existing_folder(new_deck, tmp_path):
    new_deck("Twice")
    import typer

    with pytest.raises(typer.Exit):
        cli._action_new("Twice", here=True)

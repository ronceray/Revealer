"""P4c: reproducible setups — plugin SHAs pinned, recorded versions honored."""

from __future__ import annotations

import re

from revealer import assets


def test_third_party_refs_are_commit_shas():
    for name, spec in assets.PLUGINS.items():
        if spec.get("official"):
            continue
        assert re.fullmatch(r"[0-9a-f]{40}", spec["ref"]), (
            "{0} is not pinned to a commit SHA: {1}".format(name, spec["ref"]))


def test_config_roundtrip_with_plugin_refs(tmp_path):
    assets.write_presentation_config(
        str(tmp_path), ["markdown", "chalkboard"],
        reveal_version="4.9.9", plugin_refs={"chalkboard": "a" * 40})
    cfg = assets.read_presentation_config(str(tmp_path))
    assert cfg["presentation"]["revealjs_version"] == "4.9.9"
    assert cfg["presentation"]["extensions"] == ["markdown", "chalkboard"]
    assert cfg["plugins"] == {"chalkboard": "a" * 40}
    assert assets.read_presentation_extensions(str(tmp_path)) == [
        "markdown", "chalkboard"]


def _spy_downloads(monkeypatch):
    calls = {"core": [], "plugins": []}

    def fake_core(reveal_dir, version, log=print):
        calls["core"].append(version)

    def fake_plugin(reveal_dir, spec, log=print):
        calls["plugins"].append((spec["repo"], spec["ref"]))

    monkeypatch.setattr(assets, "_download_revealjs_core", fake_core)
    monkeypatch.setattr(assets, "_download_plugin", fake_plugin)
    monkeypatch.setattr(assets, "inject_revealer_assets", lambda rd: None)
    monkeypatch.setattr(assets, "generate_index_html", lambda rd, ex: None)
    return calls


def test_setup_honors_recorded_version_and_pins(tmp_path, monkeypatch):
    calls = _spy_downloads(monkeypatch)
    assets.write_presentation_config(
        str(tmp_path), ["markdown", "chalkboard"],
        reveal_version="4.2.1", plugin_refs={"chalkboard": "b" * 40})

    assets.setup_revealjs(str(tmp_path), ["markdown", "chalkboard"],
                          force=False, log=lambda *a: None)
    assert calls["core"] == ["4.2.1"]
    assert calls["plugins"] == [("rajgoel/reveal.js-plugins", "b" * 40)]
    # the honored pins are re-recorded, not lost
    cfg = assets.read_presentation_config(str(tmp_path))
    assert cfg["presentation"]["revealjs_version"] == "4.2.1"
    assert cfg["plugins"]["chalkboard"] == "b" * 40


def test_force_repins_to_current_table(tmp_path, monkeypatch):
    calls = _spy_downloads(monkeypatch)
    assets.write_presentation_config(
        str(tmp_path), ["markdown", "chalkboard"],
        reveal_version="4.2.1", plugin_refs={"chalkboard": "b" * 40})

    assets.setup_revealjs(str(tmp_path), ["markdown", "chalkboard"],
                          force=True, log=lambda *a: None)
    assert calls["core"] == [assets.REVEALJS_VERSION]
    table_ref = assets.PLUGINS["chalkboard"]["ref"]
    assert calls["plugins"] == [("rajgoel/reveal.js-plugins", table_ref)]
    cfg = assets.read_presentation_config(str(tmp_path))
    assert cfg["presentation"]["revealjs_version"] == assets.REVEALJS_VERSION
    assert cfg["plugins"]["chalkboard"] == table_ref

"""Shadow-git save history (serve helpers)."""

import shutil

import pytest

from revealer.serve import HISTORY_DIR, _history_commit, _history_init, _history_list, _history_show

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")


def test_history_cycle(tmp_path):
    pdir = tmp_path / "deck"
    pdir.mkdir()
    pres = pdir / "talk.pres"
    pres.write_text("=== One\n\nv1\n")
    assert _history_init(pdir)
    assert (pdir / HISTORY_DIR / "HEAD").exists()
    assert not (pdir / ".git").exists()  # never touches a real repo

    assert _history_commit(pdir, pres, "first", auto=True)
    assert not _history_commit(pdir, pres, "again", auto=True)  # no change → no commit
    pres.write_text("=== One\n\nv2\n")
    assert _history_commit(pdir, pres, "note", auto=False)

    entries = _history_list(pdir)
    assert len(entries) == 2
    assert entries[0]["msg"] == "save: note" and entries[0]["auto"] is False
    assert entries[1]["auto"] is True

    old = _history_show(pdir, pres, entries[1]["hash"])
    assert old == "=== One\n\nv1\n"
    assert _history_show(pdir, pres, "nothex!") is None

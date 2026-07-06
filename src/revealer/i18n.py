"""Localization for the Revealer CLI's user-facing console messages.

``t(key, **kw)`` looks a template up in the locale catalog (falling back to
``en`` then to the key itself) and ``str.format``s it with the keyword args.
Templates keep their rich ``[green]``/``[red]`` markup; only the words are
translated. The locale is read once from the environment (``LC_ALL`` /
``LC_MESSAGES`` / ``LANG``): a value starting with ``fr`` selects French.

``CATALOG['en']`` and ``CATALOG['fr']`` are kept in lock-step; the parity is
asserted by ``tests/test_i18n.py``.
"""

from __future__ import annotations

import os

CATALOG: dict[str, dict[str, str]] = {
    "en": {
        "cli.no_root": "[red]No presentations root configured.[/red] "
                       "Set one with:  [bold]revealer root <path>[/bold]",
        "cli.no_pres_at": "[red]No .pres file found at {dir}.[/red]",
        "cli.no_pres_in": "[red]No .pres file found in {dir}.[/red]",
        "cli.no_pres_found": "[red]No .pres file found.[/red]",
        "cli.browser_fail": "[yellow]Could not open a browser; open {html} manually.[/yellow]",
        "cli.root_is": "Presentations root: [bold]{root}[/bold]",
        "cli.no_root_configured": "[yellow]No root configured.[/yellow]",
        "cli.root_set": "Presentations root set to [bold]{root}[/bold]",
        "cli.already_exists": "[red]{dir} already exists.[/red]",
        "cli.setting_up": "Setting up reveal.js in [bold]{dir}[/bold]...",
        "cli.created": "[green]Created[/green] {path}",
        "cli.built": "[green]Built[/green] {path}",
        "cli.loaded": "[green]Loaded[/green] {path}",
        "cli.opened": "Opened [bold]{path}[/bold] in your browser.",
        "cli.updating_exts": "Updating reveal.js extensions...",
        "cli.exts_updated": "[green]Extensions updated.[/green]",
        "cli.revealjs_updated": "[green]reveal.js updated[/green] ({version}).",
        "cli.no_pres_yet": "[yellow]No presentations yet.[/yellow] Use "
                           "[bold]Load a presentation[/bold] to open one, or set a "
                           "root with [bold]revealer root <path>[/bold].",
        "cli.no_root_creating": "[yellow]No root set; creating in the current directory.[/yellow]",
        "cli.banner": "[bold]Revealer[/bold] — reveal.js scientific presentations\n",
        "cli.export_error": "[red]{error}[/red]",
        "cli.exported": "[green]Exported[/green] {path}",
    },
    "fr": {
        "cli.no_root": "[red]Aucune racine de présentations configurée.[/red] "
                       "Définissez-en une avec :  [bold]revealer root <chemin>[/bold]",
        "cli.no_pres_at": "[red]Aucun fichier .pres trouvé dans {dir}.[/red]",
        "cli.no_pres_in": "[red]Aucun fichier .pres trouvé dans {dir}.[/red]",
        "cli.no_pres_found": "[red]Aucun fichier .pres trouvé.[/red]",
        "cli.browser_fail": "[yellow]Impossible d’ouvrir un navigateur ; "
                            "ouvrez {html} manuellement.[/yellow]",
        "cli.root_is": "Racine des présentations : [bold]{root}[/bold]",
        "cli.no_root_configured": "[yellow]Aucune racine configurée.[/yellow]",
        "cli.root_set": "Racine des présentations définie sur [bold]{root}[/bold]",
        "cli.already_exists": "[red]{dir} existe déjà.[/red]",
        "cli.setting_up": "Installation de reveal.js dans [bold]{dir}[/bold]...",
        "cli.created": "[green]Créé[/green] {path}",
        "cli.built": "[green]Compilé[/green] {path}",
        "cli.loaded": "[green]Chargé[/green] {path}",
        "cli.opened": "Ouvert [bold]{path}[/bold] dans votre navigateur.",
        "cli.updating_exts": "Mise à jour des extensions reveal.js...",
        "cli.exts_updated": "[green]Extensions mises à jour.[/green]",
        "cli.revealjs_updated": "[green]reveal.js mis à jour[/green] ({version}).",
        "cli.no_pres_yet": "[yellow]Aucune présentation pour l’instant.[/yellow] Utilisez "
                           "[bold]Charger une présentation[/bold] pour en ouvrir une, ou "
                           "définissez une racine avec [bold]revealer root <chemin>[/bold].",
        "cli.no_root_creating": "[yellow]Aucune racine définie ; création dans le "
                                "répertoire courant.[/yellow]",
        "cli.banner": "[bold]Revealer[/bold] — présentations scientifiques reveal.js\n",
        "cli.export_error": "[red]{error}[/red]",
        "cli.exported": "[green]Exporté[/green] {path}",
    },
}


def locale() -> str:
    """Resolve the CLI locale from the environment (fr* → 'fr', else 'en')."""
    for var in ("LC_ALL", "LC_MESSAGES", "LANG"):
        val = os.environ.get(var)
        if val:
            return "fr" if val.lower().startswith("fr") else "en"
    return "en"


def t(key: str, **kw: object) -> str:
    """Localized template for *key*, formatted with the keyword arguments."""
    table = CATALOG.get(locale(), CATALOG["en"])
    template = table.get(key) or CATALOG["en"].get(key) or key
    return template.format(**kw) if kw else template

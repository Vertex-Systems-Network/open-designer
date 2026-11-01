---
title: Dateien untersuchen
description: Dokumentbaum, Objekte, Seiten und Variablen über die CLI lesen.
---

# Dateien untersuchen

Die CLI liest `.fig`-Dateien, ohne den Editor zu öffnen. Läuft die Desktop-App, kann der Dateiname entfallen; die CLI verwendet dann RPC für das geöffnete Dokument.

::: tip Installation

```sh
npm install -g @open-designer/cli
# oder
bun add -g @open-designer/cli
```

:::

## Dokumentinformationen

```sh
opendesigner info design.fig
```

Zeigt Seiten, Objektanzahl, verwendete Schriften und Dateigröße.

## Dokumentbaum und Suche

```sh
opendesigner tree design.fig
opendesigner find design.fig --type TEXT
opendesigner find design.fig --name "Button"
```

## XPath-Abfragen

```sh
opendesigner query design.fig "//FRAME"
opendesigner query design.fig "//TEXT[@fontSize >= 24]"
opendesigner query design.fig "//*[@visible = false]"
```

Attributnamen wie `fontSize`, `layoutMode` und `strokeWeight` entsprechen der API und bleiben unverändert.

## Objekte, Seiten und Variablen

```sh
opendesigner node design.fig --id 1:23
opendesigner pages design.fig
opendesigner variables design.fig
```

## Geöffnetes Dokument

```sh
opendesigner documents list
opendesigner tree --document-id tab-123 --page-id 0:1
```

Für automatisierte Abläufe zuerst `opendesigner documents list --json` aufrufen und anschließend `--document-id` und `--page-id` ausdrücklich übergeben. Dokumente öffnen, speichern, wechseln und schließen, Rückgängig machen, Einstellungen ändern und beliebige Editor-Werkzeuge aufrufen: siehe [Controlling the App](/programmable/cli/app-control).

## Qualitätsprüfung

```sh
opendesigner lint design.fig
opendesigner lint design.pen --preset strict
opendesigner lint design.fig --rule color-contrast
opendesigner lint design.fig --fix -o fixed.fig
```

Alle Befehle unterstützen `--json`; jede Meldung enthält ihre `fix`- und `suggestions`-Angaben als Daten. `--fix` wendet die sicheren Korrekturen an – Farben werden an die passende Farbvariable gebunden und die Geometrie auf ganze Pixel gerundet – und schreibt das Ergebnis in die mit `-o` angegebene `.fig`-Datei.

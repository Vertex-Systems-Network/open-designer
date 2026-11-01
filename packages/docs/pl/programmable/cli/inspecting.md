---
title: Przeglądanie dokumentów
description: Drzewo obiektów, wyszukiwanie według nazwy i typu oraz właściwości z terminala.
---

# Przeglądanie dokumentów

CLI pozwala analizować dokumenty projektu bez uruchamiania edytora. Te same polecenia działają z otwartą aplikacją komputerową, jeśli nie podasz pliku.

::: tip Instalacja

```sh
npm install -g @open-designer/cli
# albo
bun add -g @open-designer/cli
```

:::

## Informacje ogólne

Liczba stron i obiektów, używane czcionki oraz rozmiar pliku:

```sh
opendesigner info design.fig
```

## Drzewo obiektów

```sh
opendesigner tree design.fig
```

## Wyszukiwanie obiektów

Według typu:

```sh
opendesigner find design.fig --type TEXT
```

Według nazwy:

```sh
opendesigner find design.fig --name "Button"
```

## Zapytania XPath

Selektory XPath wyszukują obiekty według typu, atrybutów i położenia w drzewie:

```sh
opendesigner query design.fig "//FRAME"
```

```sh
opendesigner query design.fig "//TEXT"                    # Wszystkie obiekty tekstowe
opendesigner query design.fig "//COMPONENT"               # Wszystkie komponenty
opendesigner query design.fig "//INSTANCE"                # Wszystkie egzemplarze
opendesigner query design.fig "//FRAME[@width < 300]"     # Ramki węższe niż 300 px
opendesigner query design.fig "//*[@cornerRadius > 0]"    # Obiekty z zaokrąglonymi narożnikami
opendesigner query design.fig "//*[@visible = false]"     # Ukryte obiekty
opendesigner query design.fig "//SECTION//TEXT"            # Tekst wewnątrz sekcji
```

Nazwy dostępnych atrybutów, takie jak `fontSize`, `layoutMode` i `strokeWeight`, pozostają zgodne z API.

## Właściwości obiektu

```sh
opendesigner node design.fig --id 1:23
```

## Strony i zmienne

```sh
opendesigner pages design.fig
opendesigner variables design.fig
```

## Praca z otwartą aplikacją

Jeśli aplikacja komputerowa jest uruchomiona, nie podawaj ścieżki pliku. CLI połączy się przez RPC z otwartym dokumentem:

```sh
opendesigner documents list
opendesigner tree
opendesigner tree --document-id tab-123 --page-id 0:1
opendesigner eval --document-id tab-123 --page-id 0:1 -c "..."
```

W procesach automatycznych najpierw wywołaj `opendesigner documents list --json`, a potem jawnie przekazuj `--document-id` i `--page-id`. Otwieranie, zapisywanie, przełączanie i zamykanie dokumentów, cofanie zmian, ustawienia i wywoływanie dowolnych narzędzi edytora opisuje [Controlling the App](/programmable/cli/app-control).

## Kontrola jakości

Sprawdzanie nazw, układu, struktury i dostępności:

```sh
opendesigner lint design.fig
opendesigner lint design.pen --preset strict
opendesigner lint design.fig --rule color-contrast
opendesigner lint design.fig --list-rules
opendesigner lint design.fig --fix -o fixed.fig
```

Wyjście `--json` zawiera dla każdego komunikatu dane `fix` i `suggestions`. Opcja `--fix` stosuje bezpieczne poprawki — wiąże kolory z pasującą zmienną koloru i zaokrągla geometrię do pełnych pikseli — a wynik zapisuje w pliku `.fig` podanym w `-o`.

## Wyjście JSON

Wszystkie polecenia obsługują `--json`. Wynik można przekazać do `jq`, CI albo innego programu.

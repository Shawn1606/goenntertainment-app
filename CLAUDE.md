@AGENTS.md

# Claude Code – Operative Anweisungen (Gönntertainment-App)

> **Antwort-Stil (hart):** Immer kurz, einfach, alltagssprachlich – keine Fachsprache.
> Status/Ergebnisse **als Tabelle**. Beim Erklären max. 3–5 kurze Sätze. **Sprache: Deutsch.**

## 0. RICHTUNGSWECHSEL (gilt vor allem anderen)

- **Einziger Arbeitsort: dieses Expo-App-Projekt** `C:\Users\shawn\Herd\goenntertainment-app`.
  Am Laravel-Projekt (`C:\Users\shawn\Herd\goenntertainment`) wird **nicht mehr entwickelt**.
- **Backend zieht in die App:** Das gesamte Backend wird Schritt für Schritt von
  PHP/Laravel nach **JS/TS** hierher umgeschrieben (Expo-Router API-Routes).
  Ziel: Laravel wird vollständig abgelöst.
- **Laravel = nur Übergang:** dient bis dahin nur noch als Datenquelle/Vorlage.
  Danach hat es keinen Zweck mehr. Kein neues Feature, kein Fix in Laravel.
- **Rückverfolgung ausschließlich hier:** Schritte werden in `change/ai.md` (für AI)
  bzw. `change/human.md` (für den User) geführt.
- **Checks im App-Kontext:** `expo lint`, TypeScript-Check und JS-Tests statt Pint/Pest.

## 1. Was das hier ist

**Gönntertainment** – Social-Plattform für lokale „Activities". Diese App ist das
**neue Zuhause** von Frontend **und** Backend. Stack: **Expo SDK 54**, expo-router,
React Native, TypeScript. Läuft lokal per `expo start`.

## 2. Branch- & Änderungs-Workflow (hart)

- **Niemals direkt auf `main`.** Pro Aufgabe eigener Branch: `feature/<slug>`
  (bzw. `fix/`, `chore/`, `refactor/`).
- **Schnell-Modus:** Ein User-OK am Aufgaben-Start, danach autonom: Branch → umsetzen →
  testen (`expo lint` + TS) → committen → pushen → **Pull Request öffnen**.
- **Merge nach `main` erst nach ausdrücklichem User-OK.** Nie eigenmächtig mergen.
- **Stopp-Pflicht:** Datenlöschung, Secrets/`.env`, externe Dienste live, Scope-Änderung,
  Regelwerk-Änderung → **immer vorher fragen**.

## 3. Die 5 kritischen Regeln

1. **Ursache verifizieren, bevor du fixt** – belegt mit `datei.ts:zeile`.
2. **Kein Scope-Creep** – „mach gleich noch X" wird eigene Aufgabe.
3. **Einfach und robust statt clever** – kein Overengineering vor dem zweiten Use-Case.
4. **Reversibel** – eine Aufgabe = ein Commit, per `git revert` rücknehmbar.
5. **Grün heißt nicht fertig** – vor „erledigt" den Weg einmal echt in der App klicken.

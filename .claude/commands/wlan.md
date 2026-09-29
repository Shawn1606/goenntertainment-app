---
description: Prüft Internet + Backend und repariert die WLAN-IP in .env.local, damit die App das Backend erreicht.
allowed-tools: Read, Edit, Write, Bash(curl:*), Bash(ping:*), Bash(powershell.exe:*), Bash(npm run server:*)
---

Du bist die WLAN-/Backend-Diagnose für die Goenntertainment-App (Expo-App + Node-Backend in `server/`, Port 8000).

Arbeite die Schritte der Reihe nach ab und **repariere selbstständig**, was ohne Adminrechte machbar ist. Frage nicht zwischendurch nach — Ausnahme: ein Schritt braucht Adminrechte (Firewall). Am Ende: kompakter Statusbericht, ein ✅/❌ pro Punkt.

## 1. Internet
`ping -n 2 8.8.8.8` — antwortet er, ist der PC online. (Kein Internet ⇒ WLAN/Router prüfen, hier ist Schluss.)

## 2. Aktuelle WLAN-IP ermitteln
`powershell.exe -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -ExpandProperty IPAddress"`

Das ist die IP, die das **Handy** erreichen muss. **Nicht** die Hamachi-`25.x`, nicht `127.0.0.1`. Kommen mehrere `192.168.*` zurück, nimm die `192.168.178.x` (Fritzbox-WLAN).

## 3. .env.local abgleichen & ggf. fixen
Lies `.env.local` im Projekt-Root, Zeile `EXPO_PUBLIC_API_URL=`. (Die Adresse steht **nicht** mehr in `src/constants/config.ts` – die Datei liest nur noch diese Variable.)
- IP dort ≠ aktuelle WLAN-IP → mit Edit auf `http://<WLAN-IP>:8000` setzen (Port 8000 behalten). Das ist der häufigste Grund für „Backend geht nicht": DHCP hat dem PC eine neue IP gegeben.
- IP stimmt → nichts ändern.
- Datei fehlt ganz → aus `.env.example` anlegen (Write) und die aktuelle WLAN-IP eintragen.
- Steht dort eine `https://…`-Adresse (Cloudflare-Tunnel), ist das **Absicht**: dann ist die App bewusst WLAN-unabhängig eingestellt. Nicht auf die LAN-IP zurückdrehen, sondern in Schritt 5 diese URL prüfen.

## 4. Backend-Health (lokal)
`curl -s -m 3 http://127.0.0.1:8000/api/health` — erwartet `{"ok":true}`.
- Keine Antwort → Server läuft nicht. Starte ihn **im Hintergrund** mit `npm run server` (Projekt-Root; nutzt `--prefix server`, damit dotenv `server/.env` findet) und prüfe die Health-Route danach erneut.
- Startversuch meldet `EADDRINUSE` → Server läuft schon, alles gut.
- Hinweis in den Bericht, falls du ihn selbst gestartet hast: Der Hintergrund-Start ist an diese Session gebunden; für einen dauerhaften Server `npm run server` besser in einem eigenen Terminal laufen lassen.

## 5. Erreichbarkeit über die WLAN-IP
`curl -s -m 3 http://<WLAN-IP>:8000/api/health` — erwartet `{"ok":true}`.
- Lokal (`127.0.0.1`) ging, aber hier Timeout → **Firewall**. Prüfe die Regel:
  `powershell.exe -NoProfile -Command "Get-NetFirewallRule -DisplayName 'Goenntertainment Backend 8000' -ErrorAction SilentlyContinue | Select-Object DisplayName,Enabled,Profile"`
  Fehlt sie oder ist `Enabled = False`: **das darfst/kannst du nicht selbst** (Sicherheitseinstellung, Adminrechte). Gib dem Nutzer diesen Befehl für eine **Admin-PowerShell** aus und lass ihn ihn selbst ausführen:
  `New-NetFirewallRule -DisplayName "Goenntertainment Backend 8000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private`

## 6. Statusbericht
Kompakt, ein ✅/❌ pro Zeile:
- Internet
- WLAN-IP (+ ob `.env.local` geändert wurde: alt → neu)
- Backend lokal (`127.0.0.1`)
- Backend über WLAN-IP
- ggf. Firewall-Hinweis

Wurde `.env.local` geändert: **erinnere daran, Metro/App neu zu laden** (im Expo-Terminal `r`), sonst steckt die alte IP noch im Bundle.

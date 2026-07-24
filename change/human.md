# Änderungen – kurz für dich (Shawn)

Hier steht in einfachen Worten, was ich in der App gemacht habe. Neueste zuletzt.

---

## 1) Backend-API gebaut (im Laravel-Projekt, nicht hier)

Damit die Handy-App sich überhaupt anmelden kann, hat das Laravel-Projekt jetzt
eine „API": eigene Adressen, über die die App **Registrieren, Login, Logout** und
„wer bin ich" macht. Die App bekommt beim Login einen **Schlüssel (Token)** und
schickt den ab dann bei jeder Anfrage mit. Das lief in einem eigenen Pull Request
und ist schon zusammengeführt.

## 2) App an die API angebunden

- Die App kann sich jetzt **registrieren und einloggen** – echte Daten, echter Server.
- Der Token wird **sicher gespeichert**, du bleibst also eingeloggt.
- Neue Aufteilung: **ausgeloggt** siehst du Willkommen/Login/Registrieren, **eingeloggt**
  die App (Home). Das schaltet automatisch um.
- **Home** zeigt deine echten Daten (Name, Benutzername, Konto-Typ) und einen Abmelden-Knopf.
- Getestet: Registrieren → Home, Abmelden → Willkommen, Login → Home. Hat funktioniert.

## 3) Altes Design + Login-Overlay zurückgeholt

- Der **weiche Pastell-Hintergrund**, der **Lila-Pink-Schriftzug** „Gönntertainment" und
  das **Maskottchen** (die kleinen Kreise) sind wieder da – wie auf der alten Webseite.
- Das **Login-Fenster fährt von unten hoch** (das „Overlay"), genau wie früher.
- **Willkommen** und **Registrieren** sehen wieder im alten Stil aus.
- Die extra Login-Seite habe ich entfernt – Login passiert jetzt im hochfahrenden Fenster,
  so wie im Original.
- Getestet: Login über das Overlay → Home. Hintergrund, Verlauf und Maskottchen werden
  sauber angezeigt, keine Fehler.

## 4) Dein Feedback zum Start-Bildschirm umgesetzt

- **„GÖ" sticht jetzt heraus**: die ersten beiden Buchstaben sind viel größer, das „Ö"
  ist groß geschrieben → **GÖ**nntertainment.
- **Der Anmelde-Knopf ist weg.** Anmelden geht jetzt nur noch durchs **Hochwischen** –
  und der graue Text sagt das jetzt klar: „↑ Nach oben wischen zum Anmelden".
- **Die umarmenden Figuren sind größer und weiter unten**; der Titel sitzt oben, es ist
  nicht mehr alles in der Mitte.
- **Der graue Strich ganz unten ist entfernt.**

Getestet: Start-Bildschirm sieht wie gewünscht aus, und Anmelden über das hochfahrende
Fenster führt weiter auf die Home-Seite.

## 5) Neuer, kürzerer Name: GÖ4Fun

Aus „Gönntertainment" ist **GÖ4Fun** geworden (kürzer, geht leichter von der Zunge:
GÖ = gönn, „4Fun" = for Fun). Das **GÖ** ist groß hervorgehoben – auf der Startseite
und oben auf der Home-Seite. Der alte Name ist überall ersetzt.

Nur der interne Projektname (für die Technik) bleibt gleich – geändert ist der Name,
den du in der App **siehst**.

---

## Was noch offen ist

- Die **Home-Seite** hat noch nicht den Pastell-Look (nur die Willkommens-/Login-Seiten).
- **Google-Login** in der App – braucht noch deinen eigenen Google-Zugang.
- **Interessen** bei der Registrierung – dafür fehlt im Backend noch eine Adresse.
- **Passwort vergessen** und echte **Aktivitäten** aus dem Server (statt Beispiel-Daten).

## Wo ich die Schritte sonst noch festhalte

- Genauere, technische Version: `change/ai.md` (im selben Ordner).
- Jeder Speicherpunkt (Commit) in der Git-Historie und im Pull Request #1 auf GitHub.

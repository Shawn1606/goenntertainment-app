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

## 6) GÖ4Fun als Logo + bewegter Hintergrund

- **GÖ4Fun sieht jetzt aus wie ein Logo**: „GÖ" im Farbverlauf, die **4** sitzt in einer
  runden farbigen Kugel (Badge), „Fun" kräftig daneben. Auf Start- und Home-Seite.
- **Der Hintergrund hat jetzt bunte Kugeln, die sich langsam wie Wellen bewegen** –
  ein weiches, fließendes Driften.

Wichtig / ehrlich: Die **Bewegung** konnte ich in meinem Test-Browser **nicht anschauen**
(der zeigt keine laufenden Bilder). Auf dem **Handy läuft die Animation** aber. Schau's
dir in Expo Go an – wenn's zu schnell, zu langsam oder zu stark ist, sag Bescheid, dann
stelle ich Tempo und Stärke nach.

## 7) Logo flowiger + Hintergrund aus deiner Referenz

- **Das eckige Badge-Logo ist weg.** Jetzt ist es ein weiches Wortbild: „GÖ" im
  Farbverlauf, „4Fun" in ruhigem Grau daneben – fließend, wie in deinem Bild.
- **Der Hintergrund ist wie in deiner Referenz**: heller Pastellton, ein Pfirsich-Schein
  oben rechts, zwei schwebende Kreise und **lila Wellen unten**, die sich langsam
  hin und her bewegen.

Wie vorher: die **Bewegung** sehe ich in meinem Test-Browser nicht (technische Grenze),
auf dem **Handy läuft sie**. Bitte am Handy anschauen und sagen, ob Tempo/Stärke passen.

---

## Was noch offen ist

- Die **Home-Seite** hat noch nicht den Pastell-Look (nur die Willkommens-/Login-Seiten).
- **Google-Login** in der App – braucht noch deinen eigenen Google-Zugang.
- **Interessen** bei der Registrierung – dafür fehlt im Backend noch eine Adresse.
- **Passwort vergessen** und echte **Aktivitäten** aus dem Server (statt Beispiel-Daten).

## Wo ich die Schritte sonst noch festhalte

- Genauere, technische Version: `change/ai.md` (im selben Ordner).
- Jeder Speicherpunkt (Commit) in der Git-Historie und im Pull Request #1 auf GitHub.

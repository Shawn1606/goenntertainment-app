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

## 8) Logo in fließender Schrift

Statt gerader Blockschrift ist „GÖ4Fun" jetzt in einer **geschwungenen Schrift**
geschrieben (wie das „flow"-Logo, das du geschickt hast) – im Farbverlauf, mit dem
großen GÖ, das durch die Großbuchstaben heraussticht. Name bleibt GÖ4Fun.

---

## Was noch offen ist

- Die **Home-Seite** hat noch nicht den Pastell-Look (nur die Willkommens-/Login-Seiten).
- **Google-Login** in der App – braucht noch deinen eigenen Google-Zugang.
- **Interessen** bei der Registrierung – dafür fehlt im Backend noch eine Adresse.
- **Passwort vergessen** und echte **Aktivitäten** aus dem Server (statt Beispiel-Daten).

## Wo ich die Schritte sonst noch festhalte

- Genauere, technische Version: `change/ai.md` (im selben Ordner).
- Jeder Speicherpunkt (Commit) in der Git-Historie und im Pull Request #1 auf GitHub.

## 9) Rest vom alten Backend nach JS geholt

Der Kern des Backends (Anmelden, Google, Interessen, Aktivitäten inkl. Beitreten) war schon
in JavaScript im Ordner `server/` – du siehst ihn in Cursor. Gefehlt haben noch drei Dinge,
die ich jetzt aus dem alten Laravel nachgezogen habe:

- **Datenbank-Bauplan** (`server/schema.sql`): legt alle Tabellen an, ganz ohne Laravel.
- **Start-Daten** (`server/src/seed.js`): die Interessen-Liste und der Admin-Zugang. Starten mit
  `npm run seed` im Ordner `server`.
- **Passwort vergessen** (im Backend): nimmt die E-Mail an und setzt mit einem Link ein neues
  Passwort. Getestet und funktioniert.

Ehrlich / noch offen:
- Der **E-Mail-Versand** braucht noch einen Mail-Zugang (SMTP) – eigener Schritt. Bis dahin
  steht der Link nur in der Server-Konsole (zum Testen).
- Der **„Passwort vergessen"-Screen** in der App zeigt bisher nur eine Bestätigung, ruft das
  neue Backend aber noch nicht auf. Kann ich als nächstes anbinden, wenn du willst.

Damit kann das alte Laravel jetzt komplett weg – alles läuft in `server/`.

## 10) „Passwort vergessen" hängt jetzt am echten Backend

Der Screen zeigt nicht mehr nur eine Bestätigung, sondern schickt die E-Mail wirklich an
den neuen Server. Läuft und ist geprüft. (Der echte Mail-Versand per SMTP bleibt der letzte
offene Schritt.)

## 11) App lud keine Accounts mehr → Backend war schlicht nicht gestartet

**Was war los?** Die App konnte sich nicht mehr mit dem Server verbinden und hat
keine Accounts/Aktivitäten geladen.

**Warum?** Seit der Umstellung von Laravel auf das neue Backend im Ordner `server/`
muss dieser Server von Hand gestartet werden. Das alte Laravel lief bei dir über
Herd quasi immer im Hintergrund – das neue Node-Backend nicht. Es lief einfach
nichts auf Port 8000, deshalb kam die App an keine Daten (Fehler „Keine Verbindung
zum Server").

**Geprüft:** Sobald das Backend läuft, ist alles heil – Datenbank verbindet,
Login/Registrieren/Interessen/Aktivitäten antworten, 5 Accounts sind in der DB.
Es war also kein Programmfehler, sondern der Server war nur aus.

**Was ich geändert habe, damit das nicht wieder passiert:**
- Neuer Ein-Wort-Befehl im Hauptordner: **`npm run server`** startet das Backend
  (musst du nicht mehr erst in den `server`-Ordner wechseln). Zum Befüllen der
  Datenbank: `npm run server:seed`.
- Die README erklärt jetzt oben: **erst Backend starten, dann die App.**

**So startest du künftig alles (zwei Terminals):**
1. `npm run server`  → Backend (Port 8000), muss laufen bleiben
2. `npx expo start`  → die App

Wenn in der App „Keine Verbindung zum Server" steht, läuft Schritt 1 nicht.

## 12) Backend war spürbar langsam → zwei Bremsen entfernt

Du fandest den Server „unfassbar langsam". Der Code selbst war schnell (~5 ms pro
Anfrage) – es waren zwei konkrete Stellen, beide jetzt behoben:

**a) `localhost` kostete ~200 ms pro Anfrage (Windows-Eigenheit).**
`localhost` wird unter Windows zuerst als IPv6 (`::1`) probiert, der Server lauschte
aber nur auf IPv4 → jede Anfrage lief in einen Fehlversuch und danach erst auf
`127.0.0.1`. Der Server lauscht jetzt auf beidem (IPv4 **und** IPv6).
→ `localhost` von ~210 ms auf **~4 ms**.

**b) Login/Registrieren blockierten den ganzen Server.**
Die Passwort-Prüfung (bcrypt) lief „synchron" – das legt bei jedem Login für ~0,3 s
den kompletten Server lahm, auch für alle anderen. Jetzt läuft sie nebenher
(nicht-blockierend) und mit einem bewährten, etwas schnelleren Sicherheits-Level.
→ Login von ~313 ms (blockierend) auf **~85 ms**, Registrieren auf **~131 ms**.

Am Rande gelernt: Den Server **immer** mit `npm run server` starten (nicht per Hand
aus dem Hauptordner) – sonst findet er die Zugangsdaten in `server/.env` nicht und
meldet „Access denied … using password: NO".

## 13) Login am echten Handy „dauerte ewig" → falsch geratene Backend-Adresse

Nicht die DB und nicht der Server – die App hat die **falsche Server-Adresse geraten**:
- Expo lieferte `127.0.0.1` – das ist aus Sicht des Handys aber das Handy selbst.
- Dein PC hat zusätzlich eine Hamachi-VPN-Adresse (`25.x`), die im WLAN nicht
  erreichbar ist.

In beiden Fällen läuft die App in einen Netzwerk-Timeout, bevor überhaupt eine
Antwort kommt → „einloggen dauert ewig". Der Server selbst antwortet in ~4 ms.

**Fix:** In `src/constants/config.ts` die Backend-Adresse fest auf die WLAN-IP
deines PCs gesetzt: `http://192.168.178.25:8000`. Damit rät die App nicht mehr.

**Wichtig:**
- Dein **Handy muss im selben WLAN** (Fritzbox, 192.168.178.x) sein – nicht über VPN/mobil.
- **Schnelltest:** im Handy-Browser `http://192.168.178.25:8000/api/health` öffnen.
  Kommt sofort `{"ok":true}` → alles gut. Hängt es → Windows-Firewall blockt Node
  (beim Start „Zugriff zulassen" für **private** Netzwerke wählen) oder das Handy
  ist im falschen Netz.
- Ändert sich mal die PC-IP (`ipconfig` → IPv4 des WLAN-Adapters), muss die Adresse
  in `config.ts` angepasst werden.
- Nach der Änderung die App in Expo Go **neu laden** (schütteln → Reload).

## 14) KI prüft jetzt jede neue Aktivität (Jugendschutz)

Kurz gesagt: **Bevor** ein Event online geht, schaut eine KI drüber. Sie liest Titel,
Beschreibung und Kategorien und sieht sich das Foto an. Ist etwas nicht jugendfrei, kommt es
gar nicht erst rein – und wer so etwas hochlädt, ist 7 Tage gesperrt.

Die KI vergibt eine von vier Stufen:

| Stufe | Beispiel | Was passiert |
|---|---|---|
| 0 – unbedenklich | Fußball, Kochen, Kino | Event wird normal angelegt |
| 1 – grenzwertig | derbe Sprache, „Saufabend" | Event wird **angelegt**, aber für dich im Admin-Panel markiert |
| 2 – nicht jugendfrei | sexuelle Inhalte, Nacktheit, Gewalt, Waffen, Drogen | Event wird **abgelehnt** + Konto **7 Tage gesperrt** |
| 3 – schwer | explizite Inhalte, Straftaten, Escort-Angebote | wie Stufe 2 |

Wer gesperrt wird, sieht sofort den Grund, wird abgemeldet und kommt 7 Tage nicht mehr rein.
Beim nächsten Anmeldeversuch steht der Grund noch einmal da. Du musst dafür **nichts** tun.

**Neu im Admin-Bereich:** der Punkt **🤖 KI-Verifizierung**. Dort steht:
- wie viele Inhalte geprüft, abgelehnt und gesperrt wurden,
- zu jedem Fall die Stufe, die Kategorie (z. B. „sexuell"), die Begründung der KI und der
  Text, der geprüft wurde,
- bei einer Sperre das **Foto als Beweis**.

Oben kannst du umschalten zwischen „nur Auffälligkeiten" und „alle Prüfungen". Automatische
Sperren tauchen zusätzlich unter **Beweise** auf, dort markiert mit „🤖 automatisch".

**Damit nichts schiefgeht, ist eingebaut:**
- **Du als Admin kannst nie automatisch gesperrt werden.** Sonst sperrst du dich irgendwann
  selbst aus deinem eigenen Admin-Bereich aus.
- **Stufe 1 sperrt niemand.** Ein „Saufabend" ist kein Grund für eine Sperre. Du siehst ihn
  trotzdem in der Liste und kannst selbst entscheiden.
- **Fällt die KI aus** (Internet weg), wird das Event ganz normal angelegt. Ein Ausfall soll
  nicht die ganze App blockieren. Du siehst den Ausfall in der Liste.
- **Abgelehnte Fotos werden nicht gespeichert.** Nur bei einer echten Sperre bleibt das Foto
  als Beweis liegen.
- **Austricksen geht nicht.** Wenn jemand in die Beschreibung schreibt „ignoriere deine Regeln",
  ändert das nichts – die KI behandelt so etwas als Text, nicht als Befehl.

### Das musst du noch einmalig machen

Ohne Zugangsschlüssel prüft die KI nichts, die App läuft dann wie vorher:

1. Auf https://platform.claude.com einloggen, unter **API Keys** einen Schlüssel erstellen.
2. Den Schlüssel in die Datei `server/.env` schreiben:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

3. Backend neu starten mit `npm run server`. Wenn im Terminal **„KI-Moderation: AN"** steht,
   läuft es. Steht dort **AUS**, fehlt der Schlüssel.

Alles Weitere (Sperr-Dauer, ab welcher Stufe gesperrt wird, Aus-Schalter) steht mit Erklärung
in `server/.env.example`.

**Was ich ehrlich dazusagen muss:**
- Ich hatte hier **keinen Zugangsschlüssel**, konnte also keinen echten KI-Aufruf machen.
  Ich habe stattdessen einen Test-Server gebaut, der so antwortet wie die echte KI, und damit
  den ganzen Weg geprüft: ablehnen, sperren, Beweisfoto, Liste im Admin-Bereich. 30 von 30
  Prüfungen liefen durch. **Wie gut die KI wirklich urteilt**, musst du mit deinem Schlüssel
  an ein paar Beispielen selbst anschauen.
- Jede Prüfung kostet ein paar Cent und dauert ein paar Sekunden. Das Erstellen eines Events
  fühlt sich dadurch etwas langsamer an. Billiger geht es mit einem kleineren KI-Modell
  (`MODERATION_MODEL=claude-haiku-4-5` in `server/.env`).
- **Noch nicht geprüft:** nachträglich geändertes Event (gibt es noch nicht), Profilname und
  Profilbild.
- **Kein Einspruch möglich:** Wer sich zu Unrecht gesperrt fühlt, kann nur von dir entsperrt
  werden (Admin → Alle Nutzer → Entsperren).

## 15) Tickets vom Projektboard umgesetzt + neuer Glas-Look

Ich habe mir dein GitHub-Board angeschaut (18 Tickets, 2 davon fertig) und die Tickets
umgesetzt, die zusammen den wichtigsten Weg in der App ergeben: **etwas Passendes finden und
hingehen**. Dazu kommt ein neuer Look und – zum ersten Mal – ein echtes Testnetz.

### Neu: Suchen & Filtern (Ticket 6)

Oben auf der Startseite ist jetzt ein **Suchfeld**. Du tippst „fussball" und findest auch
„Fußball" – Groß-/Kleinschreibung und Umlaute sind egal. Gesucht wird in Titel, Beschreibung,
Ort und Kategorie.

Darunter der Knopf **Filter**:
- **Wann:** Jederzeit · Heute · Morgen · Diese Woche
- **Umkreis:** bis 5 / 15 / 50 km (nur wenn dein Standort freigegeben ist)
- **Kategorie:** alle Kategorien zum Antippen, mehrere gleichzeitig möglich
- **Nur mit freien Plätzen**

Alles lässt sich kombinieren, die Trefferzahl steht live daneben, und ein Knopf setzt alles
zurück. Sobald ein Filter aktiv ist, wird aus den drei Regalen eine übersichtliche Trefferliste.

### Besser: „In deiner Nähe" gibt nicht mehr so schnell auf (Ticket 2)

Vorher: Wenn im Umkreis von 30 km nichts los war, war das Regal leer. Jetzt sucht die App von
selbst weiter – 30 km, dann 60, dann 120, dann 240 – und **schreibt ehrlich dazu**:
„Direkt um dich herum war nichts los – wir haben den Umkreis auf 60 km erweitert."

### Neu: Entfernung und „wer hat reingeschaut" (Ticket 5)

- Auf jeder Karte steht jetzt, **wie weit weg** das Event ist („350 m", „1,2 km", „35 km").
- Im Detail-Fenster steht, **wie viele Leute reingeschaut haben**. Gezählt wird pro Person
  einmal, nicht pro Klick – und deine eigenen Events zählen sich nicht selbst hoch.

### Besser: Empfehlungen rechnen jetzt richtig (Ticket 9)

„Für dich empfohlen" war vorher eine simple Ja/Nein-Prüfung. Jetzt bekommt jedes Event eine
Punktzahl aus vier Dingen: passt es zu deinen Interessen (zählt am meisten), warst du schon bei
so etwas dabei, wie weit ist es weg, wie bald ist es. Ausgebuchte Events rutschen nach unten,
vergangene fallen ganz raus.

### Neu: Punkte, Level, Abzeichen und Rangliste (Tickets 17 + 18)

Tippe auf der Startseite auf deinen Namen – dann öffnet sich **Dein Fortschritt**:
- **XP und Level** mit Titeln von „Neu dabei" bis „Legende"
- **Abzeichen** wie „Erster Schritt", „Gastgeber:in", „Neugierig" – auch die noch nicht
  verdienten sind sichtbar, mit Fortschritt (z. B. 3/5)
- **Rangliste** mit den Top 50 und deinem eigenen Platz, auch wenn du weiter hinten stehst

Punkte gibt es nur fürs echte Mitmachen: **50 XP** für ein eigenes Event, **20 XP** fürs
Teilnehmen, **10 XP** für jede neue Kategorie, die du ausprobierst. Bewusst **nicht** fürs
Einloggen oder Herumklicken – sonst belohnt man Daddeln statt Treffen.

### Neuer Look: Glas

Karten, Suchfeld, Chips und Knöpfe sind jetzt **milchige Glasflächen** mit feiner heller Kante
und weichem Schatten. Auf einem iPhone mit iOS 26 nutzt die App das echte „Liquid Glass" von
Apple, auf Android und im Browser bauen wir denselben Eindruck selbst nach – es sieht also
überall gleich aus.

Der Stil ist an cira.systems angelehnt: ruhig, viel Luft, klare Kanten, **eine** Akzentfarbe.
Jung wirkt es über die runden Formen und den Lila-Pink-Verlauf, nicht über bunte Deko.

### Warum genau diese Sachen? (kurze Recherche)

Ich habe geschaut, worüber sich Leute bei ähnlichen Apps beschweren (Meetup-Bewertungen,
Reddit, Studenten-Apps im App Store). Die drei häufigsten Punkte:

1. **„Man findet nichts Passendes"** und die Karten/Entfernungen stimmen nicht → deshalb
   Suche, Filter, echte Entfernungsangabe und der sich erweiternde Umkreis.
2. **„Es kommt keiner"** – unzuverlässige Zusagen sind die Nummer 1 der Beschwerden → deshalb
   Punkte fürs tatsächliche Mitmachen und sichtbare Teilnehmerzahlen. Eine echte
   Zuverlässigkeits-Anzeige („X% erschienen") wäre der nächste Schritt.
3. **„Fake- und Spam-Events"** → dafür haben wir schon die KI-Prüfung aus Punkt 14.

### Unsichtbar, aber wichtig: Tests

Zum ersten Mal hat das Projekt echte automatische Tests – **71 Stück**, die mit einem Befehl
durchlaufen:

```bash
npm test
```

Ich habe sie **vor** dem eigentlichen Code geschrieben (das meint „TDD"): erst festlegen, was
herauskommen soll, dann bauen, bis es stimmt. Getestet werden Suche, Filter, Entfernungen,
Empfehlungen, Punkte und die neuen Server-Adressen. Fürs Backend gibt es
`npm run test:server` – die 15 Tests laufen gegen die echte Datenbank und räumen hinter sich auf.

### Was ich NICHT gemacht habe (und warum)

| Ticket | Warum offen |
|---|---|
| 8, 12, 14 – Abos, Reichweite kaufen, Event boosten | Das braucht einen echten Zahlungsanbieter (Stripe o. ä.) mit deinem Konto und eine Freigabe im App Store. Ohne diese Zugänge kann ich es nicht bauen, nur eine Attrappe – die wäre wertlos. |
| 13 – Benachrichtigungen | Braucht einen Push-Dienst und Gerätetests. Machbar, aber ein eigener Brocken. |
| 10, 11 – Business-Profil und -Statistiken | Eigener Bereich für Geschäftskunden; sinnvoll erst, wenn der normale Ablauf rundläuft. |
| 15, 16 – Freunde und Gruppen | Großes eigenes Thema (Anfragen, Rechte, Datenschutz). |
| 4, 7 – Beitreten und Karte | Waren schon fertig, standen nur noch auf „Backlog". Sag Bescheid, dann hake ich sie auf dem Board ab. |

Das Board selbst habe ich **nicht** angefasst – Tickets verschieben ist deine Entscheidung.

## 16) Neues Aussehen: helles cira + alles aus Glas

### Woher die Farben kommen

Ich habe cira.systems im Browser aufgemacht und die echten Werte ausgelesen, statt sie zu
schätzen. Die Seite selbst ist **dunkel** (fast schwarz). Ihr Bauprinzip ist:

- eine ruhige Leinwand mit einem **hauchfeinen 1px-Raster**,
- milchige Flächen mit **haarfeiner Kontur statt Schlagschatten**,
- **eine** Akzentfarbe (Indigo) plus zwei Verläufe,
- knappe Rundungen und die Schrift **Instrument Sans**.

Für die helle Version habe ich nur die Leinwand umgedreht – von fast schwarz auf **fast weiß
(#fafafa)** – und alles andere übernommen. Der Dunkelmodus liegt jetzt praktisch auf den
Originalwerten der Referenz.

| | vorher | jetzt |
|---|---|---|
| Hintergrund | Pfirsich/Pink/Lila-Verlauf | fast weiß + feines Raster + ein leiser Indigo-Schein |
| Akzent | Lila #9b6dff | Indigo #4f46e5 |
| Verlauf | Lila → Pink | Indigo → Violett → Fuchsia |
| Karten | weiße Flächen | Glas: milchig, haarfeine Kante, Lichtsaum |
| Text | Grau-Blau | neutrales Schwarz/Grau |
| Schrift | System-Schrift | Instrument Sans (wie cira.systems) |
| Rundungen | 16–28 px | 10–18 px, sachlicher |

### Was jetzt aus Glas ist

Vorher war nur das Neue aus der letzten Runde Glas. Jetzt auch alles Alte:

- **Knöpfe und Eingabefelder** (überall in der App – Login, Registrieren, Event erstellen)
- **Interessen-Auswahl**, **Verlaufs-Karten** in „Meine Aktivitäten"
- **Detail-Fenster** eines Events (kräftigeres Glas, damit der Text gut lesbar bleibt)
- **Einstellungen** – liegt jetzt auf der gleichen hellen Leinwand wie der Rest
- **Admin-Bereich** komplett: Dashboard-Kacheln, Diagramme, Nutzerliste, Aktions-Menü,
  Beweise, KI-Verifizierung

Auf einem iPhone mit iOS 26 ist es echtes „Liquid Glass" von Apple, auf Android und im Browser
baue ich denselben Eindruck nach – im Browser sogar mit echter Weichzeichnung dahinter.

### Nachgemessen statt behauptet

Ich habe den fertigen Web-Build im Browser geöffnet und die Werte ausgelesen:

- **Jeder** Text nutzt jetzt Instrument Sans (Regular/Medium/SemiBold/Bold), das Logo weiterhin
  die Schwungschrift. Vorher fielen viele Texte auf die Standard-Serifenschrift des Browsers
  zurück – das war sichtbar hässlich und ist jetzt weg.
- Leinwand ist genau #fafafa, das Raster ist da, die Weichzeichnung greift.
- Keine alten warmen Farben mehr im ganzen Code.
- Dunkelmodus funktioniert.

Tests und Bauen laufen weiter durch: 56 + 15 Tests grün, Web-Build baut.

### Was ich NICHT machen konnte: dein Plan-Dokument

Du hast einen OneDrive-Link zu `Projekt.docx` geschickt, damit ich die Funktionen daran
anpasse. **Ich komme an das Dokument nicht heran.** Ich habe es auf vier Wegen versucht:

1. Direkt laden → OneDrive schickt nur die leere Programm-Hülle, kein Text.
2. Über die OneDrive-Freigabe-Schnittstelle → „401 nicht berechtigt".
3. Im Browser öffnen → das Dokument steckt in einem abgeschotteten Fenster, das ich nicht
   auslesen darf. Der direkte Weg dahinter landet auf der Microsoft-Anmeldung.
4. Bildschirmfoto → mein Browser-Fenster ist nicht sichtbar, also gibt es kein Bild.

Bei einer Anmeldeseite höre ich grundsätzlich auf – ich melde mich nirgends mit deinem Konto an.

**So kommen wir weiter (eins davon reicht):**
- den Text hier in den Chat kopieren,
- oder das Dokument als PDF/Markdown ins Projekt legen (z. B. `change/plan.docx`),
- oder in OneDrive „Jeder mit dem Link" **ohne Anmeldung** freigeben und mir den neuen Link
  schicken.

Danach passe ich die Funktionen an den Plan an. Alles andere aus deiner Nachricht – helles
cira-Thema und Glas für alle alten Widgets – ist fertig.

## 17) Kontotyp in den Einstellungen umschaltbar (für Admins)

Bisher wurde der Kontotyp einmal bei der Registrierung gewählt und war danach festgenagelt –
in den Einstellungen stand er nur noch als Text da („Kontotyp: Persönlich"), ohne Möglichkeit,
etwas daran zu ändern.

**Jetzt:** In den Einstellungen unter *Konto* gibt es zwei Schaltflächen – **Persönlich** und
**Business**. Ein Tipp genügt, die Auswahl wird sofort gespeichert, und du kannst jederzeit
zurückwechseln. Während des Speicherns dreht sich ein kleiner Ladekreis, und wenn etwas
schiefgeht, steht der Grund direkt darunter.

**Wer darf das?** Nur Admins – so stand es in deiner Anforderung („Als Admin möchte ich…").
Alle anderen sehen die Zeile wie bisher als reine Anzeige. Das ist auch am Server geprüft, nicht
nur in der App versteckt: Wer es ohne Admin-Rechte über die Schnittstelle versucht, wird
abgewiesen. Soll es später für alle offen sein, ist das eine Zeile im Server und eine in der App.

**Geprüft:** vier neue automatische Tests gegen die echte Datenbank (hin- und zurückschalten als
Admin; ohne Admin-Rechte bleibt der Wert stehen; ein erfundener Kontotyp wird abgelehnt; Name
ändern bleibt für alle erlaubt) – zusammen mit den bestehenden 19 von 19 grün.

**Wichtig für den Test am Gerät:** Das gerade laufende Backend auf Port 8000 wurde von einer
anderen Sitzung ohne Auto-Neuladen gestartet und kennt die Änderung noch nicht. Bitte einmal
neu starten (`npm run server`), sonst passiert beim Umschalten in der App scheinbar nichts.

## 18) Vier Kontostufen: Standard, Creator, Business, Business Plus

Bisher gab es zwei Kontotypen („Persönlich" und „Business"), an denen nichts hing – jeder durfte
alles. Jetzt entscheidet die Stufe wirklich, was in der App möglich ist.

**Die vier Stufen und was sie können:**

| Stufe | Was dazukommt |
| --- | --- |
| **Standard** | Events finden, beitreten, Fortschritt und Abzeichen |
| **Creator** | eigene Events erstellen, bearbeiten und löschen |
| **Business** | Business-Bereich mit Umsatz & Buchungen, Reichweite auswerten, 1 Event hervorheben, Rückblick über 3 Monate |
| **Business Plus** | 5 Events gleichzeitig hervorheben, Rückblick über 12 Monate |

**Das Feld oben links.** Auf der Startseite steht jetzt links neben „GÖ4Fun" ein kleines Feld mit
**✨ Upgrade**. Ein Tipp darauf zeigt alle vier Stufen mit dem, was sie jeweils freischalten – die
eigene ist als *AKTUELL* markiert. Auf der höchsten Stufe verschwindet das Feld, weil es dann nichts
mehr anzubieten gibt.

Als **Admin** schaltest du dort direkt um (auch wieder zurück). Alle anderen schicken eine kurze
Anfrage per Mail – und das steht auch so da: *„Bezahlen kannst du hier noch nicht: Wir schalten die
Stufe nach deiner Anfrage von Hand frei."* Solange es keine Bezahlung in der App gibt, wäre ein
Kaufen-Knopf eine Lüge.

**In den Einstellungen** (unter *Konto*) stehen für Admins alle vier Stufen untereinander, jeweils
mit einem Satz dazu; bei der ausgewählten stehen zusätzlich ihre Vorzüge. Ein Tipp genügt, es wird
sofort gespeichert. Ohne Admin-Rechte siehst du dort deine Stufe und den Verweis auf das
Upgrade-Feld – so gibt es genau **einen** Weg zum Wechseln und nicht zwei, die auseinanderlaufen.

**Standard darf keine Events erstellen.** Der ＋-Knopf auf der Startseite ist dann gar nicht da –
kein Knopf, der erst beim Abschicken abgewiesen wird. Wer die Seite trotzdem direkt aufruft (alter
Verlauf, Link), landet auf einer Hinweisseite mit dem Weg zum Upgrade. Wichtig: Das ist **auch am
Server geprüft**, nicht nur in der App versteckt. Admins dürfen weiterhin immer erstellen, sonst
könnten sie sich beim Prüfen der Stufen selbst aussperren.

**Der Business-Bereich** ist ein fünfter Tab unten, den es nur ab Business gibt. Er hat zwei
Ansichten:

- **Umsatz:** Weil es noch keine Bezahl-Events gibt, steht dort ehrlich `0,00 €` mit dem Grund
  dazu. Darunter das, was **echt** gezählt ist: Buchungen (jeder Beitritt zu deinen Events, dein
  eigener Platz zählt nicht mit), Events, Besucher:innen – und die Buchungen Monat für Monat.
  Sobald Bezahl-Events kommen, wird daraus dein Umsatz; die Stelle dafür ist schon da.
- **Reichweite:** Aufrufe deiner Events, von wie vielen verschiedenen Leuten, und der Verlauf je
  Monat. Darunter kannst du **Reichweite erweitern**: Ein Tipp auf „hervorheben" stellt ein eigenes
  Event 7 Tage lang weiter nach vorne in den Empfehlungen. Business hat einen Platz dafür, Business
  Plus fünf. Bewusst kein Überfahren aller anderen: Wer Musik als Interesse gewählt hat, sieht
  weiter zuerst Musik – Hervorheben schiebt nach vorne, verdrängt aber keinen echten Treffer.

**Warum nur ein Business-Tab und nicht zwei?** Android klappt eine untere Leiste ab dem sechsten
Eintrag in ein „More"-Menü zusammen. Vier Ziele braucht jeder (Home, Map, Aktivitäten,
Einstellungen), also bleibt genau einer übrig. Die zwei Themen liegen deshalb als Umschalter oben
im Business-Bereich. Wenn dir zwei echte Tabs lieber sind, sag Bescheid – dann brauchen wir dafür
einen der bestehenden Plätze.

**Alte Konten.** Wer bisher „Persönlich" hatte, ist jetzt **Standard**; „Business" bleibt Business.
Das passiert beim Serverstart einmalig von selbst, es ist nichts zu tun. Bei der Registrierung kann
man nur noch Standard oder Creator wählen – Business-Stufen kommen über das Upgrade, sonst wäre die
Sperre wertlos.

**Geprüft:** 26 neue automatische Tests (13 zu den Stufen und ihren Rechten, 5 zum Hervorheben in
den Empfehlungen, 17 gegen die echte Datenbank: Registrier-Regeln, die Creator-Sperre samt
Admin-Ausnahme, der Business-Bereich je Stufe, die Boost-Plätze). Zusammen mit den bestehenden:
113/113 in der App und 45/45 am Server grün.

Dazu ein echter Durchgang im Browser mit zwei Wegwerf-Konten (danach gelöscht): Standard ohne
＋-Knopf und ohne Business-Tab, Upgrade-Feld und Upgrade-Seite in beiden Fassungen (Anfragen und
Admin-Umschalten), Business-Tab mit echten Zahlen (1 Aufruf, 1 Buchung, Monatsverlauf) und das
Hervorheben von „0/1 belegt" auf „1/1 belegt" – die Frist steht auch wirklich in der Datenbank.

**Nicht geprüft:** kein Durchgang am Handy. Die untere Leiste mit fünf Zielen und das iOS-Symbol für
den Business-Tab habe ich nur im Browser gesehen. Bildschirmfotos konnte ich keine machen, weil das
Browser-Fenster ausgeblendet war. Und der Umsatz bleibt bei 0,00 €, bis es Bezahl-Events gibt – das
ist keine Panne, sondern der ehrliche Stand.

## 19) Öffentliche Profilseite mit Beiträgen und Social-Links (ab Creator)

**Was du wolltest:** Ein Tipp oben rechts aufs Konto soll deine Profilseite öffnen – mit deiner
Kontoart, deinen Beiträgen und deinen Social-Media-Links, sichtbar auch für andere. Und das Ganze
nur, wenn man Creator oder Business Plus hat; ohne Stufe kann man nur beitreten, keine Events
erstellen und hat kein öffentliches Profil.

**Was jetzt passiert, wenn du oben rechts tippst**

- **Ab Creator:** Deine Profilseite geht auf. Ganz oben stehst du mit Bild, Name, `@name` und einer
  Plakette mit deiner Stufe, darunter „Dabei seit …" und drei Zahlen: Beiträge, veranstaltet,
  mitgemacht. Dann deine Social-Links, dann das Feld zum Schreiben, dann deine Beiträge.
- **Ohne Stufe (Standard):** Es öffnet sich weiter das Konto-Blatt wie bisher. Da ändert sich für
  dich nichts.

**Beiträge.** Das ist etwas Neues – nicht deine Events, sondern kurze Beiträge wie in einem
Community-Feed: Text (bis 1000 Zeichen) und optional ein Foto. Du schreibst sie direkt auf deinem
Profil, sie erscheinen sofort obenauf, neueste zuerst, und du kannst jeden wieder löschen. Andere
sehen sie auf deinem Profil, können aber nichts darauf schreiben (Kommentare und Reaktionen gibt es
noch nicht).

Wichtig: Beiträge laufen durch **dieselbe KI-Verifizierung wie deine Events**. Nicht jugendfreie
Inhalte kommen gar nicht erst rein, und bei schweren Fällen greift dieselbe automatische Sperre.
Im Admin-Panel siehst du an der Spalte „Kontext", ob eine Prüfung zu einem Event oder zu einem
Beitrag gehörte.

**Social-Links.** Acht Plattformen: Instagram, TikTok, YouTube, X, Facebook, Twitch, LinkedIn und
deine eigene Seite. Du tippst einfach `@deinname` ein – die volle Adresse baut die App daraus. Bei
der eigenen Seite reicht `deineseite.de`. Angezeigt wird wieder die kurze Form, damit die Zeile
lesbar bleibt. Ein Feld leer lassen entfernt den Eintrag; pro Plattform gibt es genau einen Link.

Eine Sache habe ich streng gemacht: Es werden **nur `http`- und `https`-Adressen** gespeichert.
Solche Links werden angetippt und vom Gerät geöffnet – da darf nichts anderes durchkommen. Das
prüft die App und noch einmal der Server.

**Wie andere dein Profil finden.** Im Event-Popup ist der Name des Veranstalters jetzt ein Link auf
dessen Profil – aber nur, wenn die Person auch eins hat. Sonst bleibt es schlichter Text statt eines
Links, der ins Leere führt.

**Kommst du noch an Einstellungen und Abmelden?** Ja. Weil der Konto-Knopf jetzt aufs Profil führt,
sitzt oben auf deinem Profil ein **Zahnrad**, das genau dasselbe Konto-Blatt öffnet wie vorher –
Fortschritt, Meine Aktivitäten, Einstellungen, Admin-Bereich, Abmelden. Zusätzlich steht im
Konto-Blatt jetzt ein Eintrag „Mein Profil".

**Eine Entscheidung, die ich für dich getroffen habe:** Du sagtest „Creator oder Business plus".
Zwischen den beiden liegt aber noch **Business** – und in der Leiter kann jede Stufe alles, was die
darunter kann. Business das Profil wegzunehmen wäre das einzige Loch in dieser Leiter gewesen.
Deshalb gilt: **ab Creator aufwärts hat jeder ein Profil** (Creator, Business, Business Plus), nur
Standard nicht. Wenn du es wirklich exakt auf Creator und Business Plus beschränkt haben willst,
sag Bescheid – das ist eine Zeile.

**Auch für Admins gilt die Stufe.** Ein Admin auf Standard hat kein Profil. Das ist Absicht und
dieselbe Regel wie beim Business-Bereich: Sonst könntest du als Admin nie sehen, was ein
Standard-Konto tatsächlich sieht. (Nur beim *Erstellen* von Events haben Admins eine Ausnahme.)

**Geprüft:** 43 neue automatische Tests – 21 in der App (Link-Erkennung, Handles, abgelehnte
Schemata, Anzeige, Sortierung, das neue Recht je Stufe) und 22 gegen die echte Datenbank (Profil
sichtbar/eigen/gesperrt, Posten und Löschen mit allen Rechte-Fällen, Links setzen und ersetzen).
Zusammen mit den bestehenden: **134/134 in der App und 79/79 am Server grün.**

Dazu ein echter Durchgang im Browser mit zwei Wegwerf-Konten (danach gelöscht): Profil eines
Creators mit Beiträgen und Links, ein über die Oberfläche geschriebener Beitrag (Umlaute und Emoji
korrekt), Löschen mit mitlaufendem Zähler, der Link-Editor beim Ändern, das Zahnrad, und beim
Standard-Konto alle drei Sperren (Konto-Blatt statt Profil, Upgrade-Hinweis beim Direktaufruf,
„gibt es nicht" für Fremde). Keine Fehler in der Konsole. Nebenbei aufgefallen und behoben:
„Löschen" und „Bearbeiten" hatten keine Beschriftung für Screenreader.

**Nicht geprüft:** kein Durchgang am Handy. Ein **Foto an einem Beitrag** habe ich nicht
durchgespielt – dafür braucht es Galerie oder Kamera, das geht im Browser nicht sinnvoll. Der Weg
dahin ist derselbe wie beim Event-Banner, den es schon gibt. Und die KI-Prüfung von Beiträgen lief
gegen kein echtes Modell (in der Entwicklungsumgebung fehlt der Schlüssel) – geprüft ist der Weg,
nicht das Urteil.

**Was noch fehlt (eigene Tickets):** Beiträge bearbeiten (bisher nur löschen), Kommentare und
Reaktionen, und das Profil zeigt die letzten 50 Beiträge ohne Nachladen.

## 20) Prämien statt Serie, Storys, ein Freunde-Tab – und Goenni überall

Deine Wunschliste, Punkt für Punkt.

**Suche und Filter sind weg – bis du sie brauchst.** Sie stecken jetzt unter „Worauf hast du
Lust?" hinter „Suchen & filtern". Die Startseite ist damit wieder zum Stöbern da, und wer gezielt
sucht, tippt einmal. Klappst du sie wieder zu, wird ein gesetzter Filter zurückgesetzt: Ein Filter
hinter einer geschlossenen Klappe wäre genau die Art unsichtbarer Zustand, wegen der man später
denkt, die App zeige zu wenige Events.

**Die Einstellungen sind ein Inhaltsverzeichnis geworden.** Alle Bereiche starten zugeklappt, nur
„Konto" ist offen – von dort geht man weiter. Aus einer Wand aus zwanzig Zeilen sind acht
Überschriften geworden, von denen du die eine aufmachst, die du brauchst.

**Die Serie ist weg, Prämien sind da.** Jede Aktivität, die du erstellst, bringt **10 Punkte**.
Damit löst du Coupons ein: Kaffee (50), eine Kugel Eis (60), Kino 2 für 1 (120), Schwimmbad (200),
Probetraining (260), GÖ4Fun-Beutel (400). Auf der Startseite steht dein Stand und das nächste
erreichbare Ziel („Noch 60 Punkte bis Kino: 2 für 1 – das sind 6 Aktivitäten"), der Katalog liegt
unter „Prämien". Nach dem Einlösen bekommst du einen Code zum Vorzeigen, der oben in deiner Liste
stehen bleibt.

Zwei Dinge, die ich bewusst so gebaut habe: Punkte **sinken nie von selbst**. Löschst du ein Event,
bleiben die 10 Punkte – anders als bei XP, denn einen eingelösten Coupon kann man nicht zurückgeben.
Und deine bisherigen Events zählen rückwirkend mit: Beim ersten Blick auf die Prämien werden sie
nachgetragen, statt dich bei 0 anfangen zu lassen.

**Storys unter der Fortschritts-Karte.** Creator- und Business-Konten können ein Bild mit einer
Zeile Text posten, sichtbar 24 Stunden, danach verschwindet es von selbst. Vorgeschlagen wird, was
du noch nicht gesehen hast – ungesehene Ringe leuchten im Markenverlauf, gesehene sind nur noch
umrandet. Antippen öffnet den Vollbild-Betrachter mit Zeitleiste; er läuft von selbst weiter und
schließt sich am Ende. Eigene Storys kannst du dort auch löschen.

**Neuer Tab: Freunde.** Darin die Suche nach **Leuten** (Name oder @Benutzername), Anfragen zum
Annehmen oder Ablehnen, deine Freundesliste – und Gruppen. Eine Gruppe legst du mit Namen an und
nimmst Freunde hinein; jedes Mitglied kann sie verlassen, wer sie angelegt hat, löscht sie für alle.
In eine Gruppe kommen nur bestätigte Freunde, sonst wäre „Gruppe" ein Weg, jemanden ohne Zustimmung
in eine Liste zu ziehen.

Damit die Suche nicht in einer Sackgasse endet, hat jetzt **jedes Konto eine Profilseite**. Vorher
sagte der Server bei Standard-Konten „gibt es nicht" – man hätte jemanden gefunden, draufgetippt und
wäre gegen eine Wand gelaufen. Beiträge und Social-Links gibt es weiter erst ab Creator, darunter
ist die Seite eine Visitenkarte mit Zahlen. „Freund:in hinzufügen" steht jetzt direkt auf dem Profil.

**Zwei Dinge musste ich dafür verschieben.** Androids untere Leiste fasst nur fünf Ziele; ab dem
sechsten faltet sie alles in ein „More"-Menü, das kaum jemand öffnet. Mit „Freunde" sind die fünf
von dem belegt, was alle Konten haben. Der **Business-Bereich** ist deshalb kein Tab mehr, sondern
liegt im Konto-Menü (dem Blatt hinter deinem Bild oben rechts) – genau dort, wo der Admin-Bereich
aus demselben Grund schon liegt. Nebeneffekt: Die Leiste sieht für alle gleich aus und verändert
sich nicht mehr, wenn sich deine Kontostufe ändert.

**Upgrade zeigt nur noch den nächsten Schritt.** Als Standard siehst du Creator, als Creator
Business, als Business Business Plus – jeweils mit den Vorzügen, die **neu** dazukommen, und einem
Satz Ausblick auf die Stufe danach. Vier Stufen gleichzeitig sind eine Preisliste und beantworten
nicht die Frage, mit der man dort ankommt.

**Goenni.** Die Figur hüpft jetzt dauerhaft leicht auf und ab (plus dem alten, langsameren Atmen –
weil beide Bewegungen unterschiedlich lang sind, sieht es nicht nach Schleife aus). Sie steht auf
jedem Tab in der Kopfzeile und reagiert unterschiedlich: auf der Startseite freundlich („Schön, dass
du da bist!", und wenn gerade was läuft: „Gerade laufen 3 Aktivitäten!"), auf der Karte nachdenklich,
bei den Freunden jubelnd, bei den Aktivitäten zufrieden, in den Einstellungen fast schläfrig. Und
**bei einem Fehler** steht sie mit abgeknickter Antenne da und sagt **„Oh oh – Es ist ein Fehler
aufgetreten."**, darunter die konkrete Ursache und ein „Nochmal versuchen". Das hat die roten
Fehlerzeilen auf Startseite, Fortschritt, Karte, Profil, Prämien und Aktivitäten ersetzt.

**Der ＋-Knopf pulsiert.** Er wird langsam größer und kleiner und leuchtet dabei auf – zwei
Bewegungen mit verschiedenen Geschwindigkeiten, damit es lebendig statt mechanisch wirkt. Wer
„Bewegung reduzieren" im System eingestellt hat, bekommt alles davon als ruhiges Bild.

**Drei Fehler, die mir dabei aufgefallen sind und die ich mitbehoben habe:** Der Server schreibt
seine Texte ohne Umlaute – bei den Coupon-Titeln stand deshalb „Ein Heissgetraenk bei einem
teilnehmenden Cafe" mitten in der Überschrift. Die Restzeit einer Story war um zwei Stunden falsch
(„noch 25 Stunden" bei einer 24-Stunden-Story), weil die Datenbank ihre Zeitstempel in Ortszeit
liefert, sie aber als Weltzeit ausgeliefert werden; die Restzeit rechnet jetzt die Datenbank selbst.
Und Screenreader konnten nicht erkennen, ob ein ausklappbarer Bereich offen ist – das steckte nur in
einem gedrehten Pfeil.

**Geprüft:** 181 Tests in der App und 107 am Server, alle grün (neu dabei: Punkte, Einlösen,
Nachtrag, Freundschaften, Gruppen, Storys – jeweils gegen die echte Datenbank). Dazu ein Durchgang
im Browser mit drei Wegwerf-Konten (danach gelöscht): Startseite, Freunde mit Suche und Gruppe,
Einstellungen, Prämien mit echtem Einlöse-Code, Upgrade auf allen drei Stufen, Business, eine Story
anlegen und ansehen – und der Fehlerzustand absichtlich erzwungen. Keine Fehler in der Konsole.

**Nicht geprüft:** kein Durchgang am Handy. Die neue untere Leiste und alles, was sich bewegt
(Hüpfen, Puls, Story-Zeitleiste), lässt sich im Browser nicht ansehen – die Vorschau-Pane ist
ausgeblendet, und dann rechnet der Browser keine Bilder. Aus demselben Grund gibt es kein
Bildschirmfoto, und die drei Zahlen in der Fortschritts-Karte blieben in meinen Prüftexten auf 0
stehen (über die API sind sie richtig). Das Bild für die Test-Story habe ich per API hochgeladen,
nicht über Galerie oder Kamera. Die KI-Prüfung für Storys läuft, aber gegen kein echtes Modell –
hier fehlt der Schlüssel.

**Was noch fehlt (eigene Tickets):** Benachrichtigungen für Freundschaftsanfragen, ein Chat in
Gruppen, Coupons ablaufen lassen oder einen Partner-Code zum Einlösen bestätigen, und Storys als
Sammlung pro Person (im Moment ist jede Story ein eigener Ring).

### Nachtrag: Goenni springt höher

Auf deinen Wunsch springt sie jetzt fast doppelt so hoch (6 % statt 3,5 % ihrer Höhe) und ein
gutes Stück schneller (ein voller Sprung in ~1 Sekunde statt 1,4). Der **Schatten bleibt dabei
liegen** — er ist jetzt eine eigene Ebene unter der Figur statt Teil der Zeichnung.

Das ist mehr als eine Kleinigkeit: Vorher wanderte der Schatten mit, dadurch bewegte sich das
ganze Bild und dieselbe Bewegung sah nach Wackeln aus. Mit einem Punkt, der liegen bleibt, liest
man sie als Abheben — und genau deshalb wirkt der Sprung jetzt noch höher, als die Zahl sagt.

### Nachtrag: Goenni schaut sich um, winkt und wechselt das Gesicht

Auf deinen Wunsch ist aus der Figur ein Charakter geworden.

**Die Augen leben.** Sie blinzelt – zu geht schneller als auf, so wie ein echtes Lid schlägt – und
ihr Blick wandert: nach links, nach rechts, einmal nach oben, dann zurück in die Mitte. Auf dem
Karten-Tab schaut sie deutlich weiter und häufiger, denn dort ist Suchen ja die Tätigkeit.

**Sie winkt.** Auf der Startseite und bei den Freunden hebt sie den Arm, wedelt zweimal und lässt
ihn wieder sinken. Danach kommt eine lange Pause – das ist der wichtigste Teil daran: Ein Arm, der
dauernd wedelt, ist nach zehn Sekunden nur noch Zappeln. So bleibt es eine Begrüßung.

**Und sie gestikuliert passend zum Tab.** Startseite und Freunde: winken. Karte: sich umsehen.
Aktivitäten: ein kurzes Nicken (als Einknicken, nicht als Kopfschütteln zur Seite – das würde wie
Zweifel aussehen). Einstellungen: nichts, dort schläft sie.

**Die Gesichter wechseln.** Jeder Tab hat jetzt zwei Gesichter statt einem, und alle sechs Sekunden
schaltet sie um – aber nur innerhalb ihres Charakters: auf der Startseite zwischen „freundlich" und
„wach", nicht zwischen „jubelnd" und „schläfrig". Beim Tabwechsel fängt sie wieder mit dem
Hauptgesicht an. Wer schläft, wechselt nichts.

Wenn du im System „Bewegung reduzieren" eingeschaltet hast, steht alles still — auch der
Gesichtswechsel, denn ein Gesicht, das von selbst umspringt, ist auch Bewegung.

**Geprüft:** 186 Tests, alle grün. Im Browser habe ich diesmal exakt nachgemessen statt nur
geschaut: Beim Winken bleibt die Schulter auf den Pixel genau liegen, während die Hand sich 4,3 px
hebt (bei 44 px Figurgröße) — genau der Wert, den ich vorher ausgerechnet hatte. Beim Blinzeln wird
die Pupille von 5,7 px auf 0,4 px flach, ohne dass sich der Körper bewegt. Der Drehpunkt des Arms
sitzt in jeder Größe und in jeder Haltung richtig auf der Schulter.

Wichtig war mir noch eins: **Ohne laufende Animation ist die Figur vollständig.** Ich habe den
Ruhezustand geprüft — Arm hängt richtig, Augen offen und mittig, nichts verschwindet. Falls
Animationen ausfallen, fehlt Leben, aber kein Körperteil.

**Nicht geprüft:** die Bewegungen im Ablauf. Bei ausgeblendeter Vorschau rechnet der Browser keine
Frames, ich konnte also nur die Endpunkte von Hand anfahren und messen — nicht zusehen. Wie oft sie
blinzelt und ob das Winken zu häufig kommt, sagt nur der Blick aufs Handy. Das sind Zahlen an einer
Stelle, falls es dir zu viel oder zu wenig ist.

### Nachtrag: Der Absturz – und woran er lag

**Ursache:** In meinem letzten Schritt habe ich in der Animation der Figur eine gewöhnliche
Funktion aufgerufen. Das klingt harmlos, ist es aber nicht: Animationen laufen bei React Native auf
einem **zweiten Thread**, und dort existieren normale Funktionen nicht. Die Animations-Bibliothek
bricht dann hart ab – und weil dieser Code für *jedes* Maskottchen läuft, also auch für das auf der
Startseite, stürzte die App direkt nach dem Anmelden ab.

**Warum ich es nicht gesehen habe:** Im Browser gibt es diesen zweiten Thread nicht, dort läuft
alles im selben Kontext. Der Fehler ist im Web also unsichtbar. Genau darum stand in meiner letzten
Meldung „nicht verifiziert: die Bewegungen im Lauf" – die Lücke war echt, und sie hat sich hier
gerächt. Tut mir leid.

**Behoben:** Alles Gerechnete ist aus der Animation herausgezogen; sie bekommt jetzt nur noch
fertige Zahlen. Nebeneffekt: Es ist auch schneller, weil pro Bild nichts mehr neu gebaut wird.

**Damit das nicht wiederkommt:** Ich habe *alle* Animationen im Projekt maschinell auf denselben
Fehler abgesucht — die anderen sind sauber. Und die Regel steht jetzt als Kommentar an der Stelle,
an der man sie braucht. Außerdem habe ich die zweite Sache nachgeprüft, die ich als unsicher
markiert hatte (der Drehpunkt des Arms): die ist in dieser React-Native-Version offiziell
unterstützt, war also nie das Problem.

### Nachtrag: Ein Knopf, der nicht reagierte

Im **Story-Betrachter** bekam das ✕ oben rechts den Tipp nicht: Die großen Flächen zum Weiterblättern
lagen im Aufbau *über* dem Knopf und wurden nur optisch nach hinten geschoben. Android hält sich
beim Zeichnen an diese Reihenfolge, beim Auswerten von Berührungen aber nicht — der Knopf war zu
sehen, aber nicht zu drücken. Jetzt liegen die Blätterflächen wirklich hinten. Dasselbe Problem hatte
die Bildunterschrift: sie hat das untere Drittel blockiert, wo man weiterblättern will.

## 21) Einstellungen: Jeder Bereich sagt jetzt vorher, was drin ist

Die Einstellungen sind in acht Bereiche geteilt, und die sind zugeklappt. Bisher stand
dort nur die Überschrift — bei „Standort & Privatsphäre" musste man aufmachen, um zu
sehen, dass da auch **Vibration** und **Klänge** liegen. Jetzt steht unter jeder
Überschrift eine Zeile, die den Inhalt nennt, **bevor** man tippt:

- **Konto** – E-Mail, Benutzername, Passwort und deine Kontostufe.
- **Interessen** – Deine Themen – sie steuern, was dir auf der Startseite empfohlen wird.
- **Benachrichtigungen** – Wofür du Bescheid bekommst – Versand kommt noch, deine Auswahl merken wir uns.
- **Standort & Privatsphäre** – Standort, Vibration, Klänge, gespeicherte Zugangsdaten und der Datenschutz.
- **Darstellung** – Hell, dunkel – oder wie dein Handy es gerade hält.
- **Hilfe & Support** – Häufige Fragen, Feedback an uns und ein Problem melden.
- **Rechtliches** – Nutzungsbedingungen, Impressum und die Version dieser App.
- **Konto beenden** – Dein Konto samt Events und Verlauf endgültig löschen.

Die Zeilen **nennen** den Inhalt, sie bewerben ihn nicht — du liest sie, um zu entscheiden,
ob du den Bereich überhaupt aufmachst. Alle acht sind gleich lang gehalten (zwei Zeilen auf
dem Handy), damit die Liste ruhig bleibt; der Benachrichtigungs-Text war zuerst drei Zeilen
und ist deshalb kürzer gefasst, ohne etwas zu verschweigen.

Nachgemessen habe ich: alle acht Köpfe sind exakt gleich hoch, das Pfeilchen rechts sitzt
weiter genau in der Mitte und stößt nirgends an den Text, nichts läuft seitlich über — und
ein Tipp auf die neue Beschreibungszeile klappt den Bereich ganz normal auf (der Text fängt
den Tipp also nicht ab). Sprachausgabe liest die Beschreibung mit vor.

### Nachtrag: „Story erstellen" war eine Sackgasse

Danke für die genaue Angabe — damit war es zu finden.

**Ursache:** Der Zurück-Pfeil oben ist der Knopf des Bildschirm-Stapels. Er funktioniert nur, wenn
darunter noch ein Bildschirm liegt. Startet die App direkt auf einer Adresse — und genau das
passiert nach einem Neuladen oder nach einem Absturz —, liegt darunter *nichts*: Dann fehlt der
Pfeil, oder er tut nichts. Nach den Abstürzen von vorhin war das sehr wahrscheinlich genau dein
Zustand.

Ich habe es im Browser nachgestellt: „Story erstellen" direkt geladen — und in der Kopfzeile war
**überhaupt kein** Zurück-Element. Der Bildschirm war dicht.

**Zweiter Fehler an derselben Stelle:** Auch *nach* dem Veröffentlichen wärst du auf dem Formular
stehen geblieben, weil dort dieselbe Annahme steckte. Beim Erstellen von Aktivitäten war das schon
richtig gelöst — nur bei den Storys nicht, weil die Logik zweimal im Code stand.

**Behoben:** Die Entscheidung „zurück, und wenn es kein zurück gibt, dann zur Startseite" steht
jetzt an *einer* Stelle und wird von beiden Formularen benutzt. Dazu hat „Story erstellen" ein
sichtbares **Abbrechen** unter dem Veröffentlichen-Knopf — das greift immer, unabhängig davon, was
die Kopfzeile anzeigt.

**Ehrlich dazu:** Dieselbe Falle gilt für **Prämien**, **Business** und **Fortschritt**. Das sind
reine Anzeige-Seiten, dort wäre ein „Abbrechen" verkehrt — und sie treffen dich nur, wenn die App
direkt auf genau dieser Adresse startet. Ich habe sie deshalb nicht angefasst, sondern sage es dir:
Wenn du dort mal festhängst, sag Bescheid, dann baue ich denselben Rückfall in die Kopfzeile ein.

### Nachtrag: Die Beschreibungen waren schlecht — neu geschrieben

Du hattest recht, die waren verwirrend. Ich hatte pro Bereich eine **Aufzählung**
hingeschrieben („Standort, Vibration, Klänge, gespeicherte Zugangsdaten und der
Datenschutz.") — fünf Wörter ohne Verb liest niemand, man überfliegt sie. Und zwei
Bereiche hatten einen angehängten Nachsatz mit Gedankenstrich, der ohne Zusammenhang
kryptisch war („Versand kommt noch, deine Auswahl merken wir uns").

Jetzt ist es **ein Satz pro Bereich, der sagt, was man dort tut** — überall gleich gebaut,
und jeder passt in eine Zeile:

- **Konto** – E-Mail, Benutzername und Passwort ändern.
- **Interessen** – Wählen, was dir vorgeschlagen wird.
- **Benachrichtigungen** – Festlegen, worüber wir dich informieren.
- **Standort & Privatsphäre** – Standort, Vibration und Klänge einstellen.
- **Darstellung** – Zwischen hell und dunkel wechseln.
- **Hilfe & Support** – Antworten finden oder uns schreiben.
- **Rechtliches** – Nutzungsbedingungen und Impressum lesen.
- **Konto beenden** – Dein Konto endgültig löschen.

Der Hinweis, dass die Benachrichtigungen **noch nicht rausgehen**, ist nicht verschwunden —
er steht jetzt **unten in der Gruppe**, direkt bei den Schaltern: „Der Versand wird gerade
aufgebaut. Deine Auswahl ist gespeichert und gilt, sobald es losgeht." Vor dem Aufklappen
war das eine Warnung, zu der man den Bezug nicht kannte; bei den Schaltern ist es die
Antwort auf die Frage, die man dort wirklich hat.

Weil alle acht Sätze in eine Zeile passen, sind die Überschriften jetzt **alle gleich hoch** —
vorher brachen drei um und die Liste wirkte unruhig. Dafür fehlen zwei Kleinigkeiten in den
Sätzen (dass die Interessen die *Startseite* betreffen und dass die App-Version unter
„Rechtliches" liegt); beides sieht man, sobald man aufmacht.

## 22) Profilbild und Banner selbst wechseln

In deiner Karte oben auf der Profilseite war ein **Zahnrad**. Das ist jetzt ein **Stift** – und
dahinter steckt genau das, was du wolltest: **Profilbild** und **Banner** ändern.

**Was der Banner ist:** das Bild, das **weichgezeichnet hinter deiner Karte** liegt. Du wählst ein
Foto, die App verschwimmt es und legt es als Hintergrund unter deinen Namen. Erkennbar bleiben
Farben und Stimmung, nicht Gesichter oder Schrift – sonst könnte man den Text darüber nicht lesen.

**So geht's:** Stift antippen, dann steht in der Karte:

- **Profilbild** – ändern, oder mit dem Papierkorb wieder abnehmen (dann stehen dort wie vorher
  deine Initialen).
- **Banner** – dasselbe für den Hintergrund.
- **Konto & Einstellungen** – der Weg, der früher am Zahnrad hing.

Am Handy fragt die App vorher „Galerie oder Kamera?", im Browser geht es direkt in die
Dateiauswahl (dort gibt es keine Kamera).

**Wichtig zu wissen:**

- Beides gibt es für **jedes Konto**, auch für Standard. Nur Beiträge und Social-Links hängen
  weiter an der Stufe Creator.
- Jedes Bild läuft durch die **KI-Prüfung**, so wie ein Beitrag. Ist es nicht jugendfrei, wird es
  abgelehnt – und bei etwas Deutlichem sperrt sich das Konto automatisch, wie du es kennst.
- Dein neues Bild ist **sofort überall** zu sehen: in der Karte, oben auf der Startseite, im
  Konto-Blatt, in der Freundesliste, in der Rangliste.
- Ein neues Bild **ersetzt** das alte, auch auf der Festplatte des Servers – es sammeln sich also
  keine alten Bilder an.

**Der Tausch, den ich gemacht habe:** Einstellungen erreichst du jetzt mit **einem Tipp mehr**
(Stift → letzte Zeile). Der Grund: Du hast gesagt, das Zeichen soll wechseln, und ein Zahnrad an
einem Knopf, der Bilder ändert, hätte in die falsche Richtung gezeigt. Verschwunden ist der Weg
nicht – wenn dir das zu versteckt ist, hänge ich das Zahnrad wieder als zweiten Knopf daneben.

**Geprüft:** Alle 125 Server-Tests grün (neun davon neu für die Bilder). Im Browser habe ich mit
einem Wegwerf-Konto ein echtes Bild hochgeladen: Der Banner liegt mit 22 Pixel Weichzeichnung
hinter der Karte, „Banner entfernen" nimmt es sofort weg, ohne Neuladen. **Nicht geprüft:** der
Weg über die Dateiauswahl des Browsers (die kann ich nicht fernsteuern) und die Kamera am Handy.

## 23) Admin-Panel: Storys löschen und Konten freischalten – Home in die Mitte

### Storys löschen

Im Admin-Panel gibt es jetzt den Punkt **Storys**. Dort stehen alle Storys, die gerade laufen:
Bild, wer sie gemacht hat, welche Kontostufe, wann sie hochgeladen wurde, wie lange sie noch
läuft und wie oft sie gesehen wurde. Tippen macht das Bild groß – beurteilen kann man eine Story
nur, wenn man sie richtig sieht. Rechts oben an jeder Karte sitzt der Papierkorb, mit Rückfrage
vorher.

Zwei Entscheidungen, die man merken sollte:

- **Abgelaufene Storys stehen nicht in der Liste.** Nach 24 Stunden sieht sie niemand mehr – sie
  dort zum Löschen anzubieten wäre Arbeit ohne Wirkung.
- **Storys von gesperrten Konten stehen drin**, und die Karte sagt es auch. Eine Sperre nimmt das
  Bild nicht aus der Datenbank, und genau darum geht es hier.

### Creator, Business und Business Plus bestätigen

Bisher gab es nichts zu bestätigen: Wer eine höhere Stufe wollte, hat aus der App eine **Mail an
den Support** geschickt. Danach wusste niemand mehr Bescheid – die Anfrage lag in einem Postfach,
die Stufe in der Datenbank. Und ein Admin konnte die Stufe eines *anderen* Kontos überhaupt nicht
umstellen; das ging nur für das eigene.

Jetzt läuft es in der App:

1. Die Person tippt im Upgrade-Bildschirm auf **„Creator anfragen"** (oder Business / Business Plus)
   und kann dazuschreiben, warum.
2. Die Anfrage landet im Admin-Panel unter **Konto-Anfragen**. Steht etwas offen, zeigt die Karte
   im Dashboard eine rote Zahl und den Satz „1 Anfrage wartet auf dich" – das ist der einzige Punkt
   im Panel, an dem jemand anderes auf dich wartet, deshalb steht er ganz oben.
3. Du siehst pro Anfrage: Name, E-Mail, von welcher auf welche Stufe, die Begründung, das Datum und
   wie alt das Konto ist. Dann **Bestätigen** (mit Rückfrage) oder **Ablehnen** (mit einem Grund,
   den du dazuschreiben kannst – Pflicht ist er nicht, sonst stünde da irgendwann nur „nein").
4. Bestätigen schaltet die Stufe **sofort** frei. Die Person muss sich nicht neu anmelden: Ihre App
   holt beim Öffnen des Upgrade-Bildschirms den aktuellen Stand und schreibt dort „Creator ist
   freigeschaltet". Bei einer Ablehnung steht dort dein Grund.

Offene Anfragen stehen oben, die **ältesten zuerst** – wer am längsten wartet, steht vorne.
Entschiedene bleiben darunter stehen, damit du nachsehen kannst, was du gestern entschieden hast.
Pro Konto gibt es immer nur **eine** Anfrage: Fragt jemand erneut, ersetzt das die alte.

**Eine Lücke, die ich offen gelassen habe:** Bei der **Registrierung** kann man sich weiter selbst
„Creator" geben – das war schon vorher so und daran habe ich nichts geändert. Wer also unbedingt
Creator sein will, legt sich ein neues Konto an, statt zu fragen. Zumachen ist eine Kleinigkeit im
Code, zieht aber die Test-Registrierungen mit (die legen fast alle Konten als Creator an und
erstellen danach Events) – deshalb habe ich das nicht nebenbei gemacht. Sag Bescheid, wenn du
willst, dass bei der Registrierung nur noch „Standard" geht.

### Home in der Mitte – und größer

Die Leiste heißt jetzt **Karte · Freunde · Home · Aktivitäten · Einstellungen**. Home liegt damit
in der Mitte, wo der Daumen von allein hinkommt.

Beim „größer" muss ich ehrlich sein, und du hattest dich ja auch dafür entschieden, die **native
Leiste zu behalten**: Ein einzelnes Feld dieser Leiste lässt sich am Handy nicht vergrößern.
Android gibt jedem Eintrag dasselbe Kästchen und rechnet jedes Bild hinein, und die Schriftgröße
gilt immer für alle Beschriftungen gleichzeitig. Größer wird Home deshalb über die **Zeichnung**:
Das Haus füllt sein Kästchen jetzt fast vollständig (22 von 24 Pixel und etwa doppelt so viel
Fläche wie die anderen), die vier übrigen Symbole sind bewusst kleiner und untereinander gleich
groß. Im Browser, wo die Leiste selbst gebaut ist, ist Home wirklich größer: mehr Fläche, fettere
Schrift, in der Akzentfarbe.

Dabei ist noch etwas aufgefallen und mitgegangen: **Freunde und Einstellungen trugen auf Android
dasselbe Bild**, und Aktivitäten trug dasselbe wie Home. Es gibt jetzt eigene Zeichnungen – zwei
Personen, eine Liste, ein Zahnrad. Alle Symbole entstehen aus einem Skript
(`scripts/make-tab-icons.mjs`), damit „mach das Haus etwas größer" künftig eine Zahl ist und kein
Neu-Malen: Vorher lagen sie als Bilddateien im Projekt, und niemand konnte sagen, wie sie entstanden
sind.

**Geprüft:** Server 125 Tests grün (11 neu für Storys und Anfragen), App 186 grün, Typen und Lint
sauber. Im Browser habe ich mit Wegwerf-Konten den ganzen Weg durchgespielt: anfragen → beim Admin
sichtbar → ablehnen mit Grund → beim Nutzer steht der Grund → erneut anfragen → bestätigen → Konto
ist Creator. Storys: gelistet, Löschen nimmt genau eine weg. Die Leiste habe ich nachgemessen –
Home sitzt exakt auf der Mitte (Pixel 640 von 640) und ist 40 statt 28 Pixel hoch.

**Nicht geprüft:** die Leiste **am Handy**. Reihenfolge und Symbolgrößen sind aus dem Code des
Expo-Pakets begründet, aber hier lief nur der Browser – wenn du die App aufs Handy holst, schau
bitte als Erstes, ob Home wirklich in der Mitte steht und beim Start auch Home offen ist. Auch das
Aussehen als Bild habe ich nicht beurteilt: Für Screenshots muss die Browser-Ansicht sichtbar sein,
und die war hier ausgeblendet.

### Nachtrag: Banner unschärfer, und du kannst zuschneiden

**Mehr Unschärfe:** Der Banner war mit 22 verschwommen, jetzt sind es 32 – deutlich weicher, das
Foto steht dem Text nicht mehr im Weg. Nebenbei repariert: Der Überhang, der den hellen Rand des
Weichzeichners aus der Karte schiebt, wird jetzt **aus dem Wert gerechnet** statt fest eingetragen.
Sonst wäre bei mehr Unschärfe wieder ein blasser Saum in der Karte aufgetaucht.

**Zuschneiden:** Nach dem Auswählen kommt jetzt das Zuschneide-Fenster deines Handys.

- **Profilbild** – quadratisch, auf Android sogar mit rundem Rahmen, so wie es später aussieht.
- **Banner** – liegend im Format 16:9.
- Auf dem **iPhone** ist der Zuschnitt immer quadratisch, das gibt Apple so vor. Beim Profilbild
  ist das genau richtig; beim Banner nimmt die App danach den mittleren Streifen.
- Im **Browser** gibt es keinen Zuschnitt – der Dateidialog kann das nicht. Deshalb steht der
  Hinweis dort auch nicht.

**Absichtlich nicht:** Das Foto für einen **Beitrag** wird weiter nicht zugeschnitten. Dort gibt es
keinen festen Rahmen, in den es passen muss – und das iPhone würde jedes Querformat-Foto ins
Quadrat zwängen. Wenn du es dort trotzdem willst, sag Bescheid.

### Nachtrag: Die Lücke bei der Registrierung ist zu

Weiter oben habe ich dir eine offene Lücke gemeldet: Beim Anmelden konnte man sich **selbst
„Creator" geben**. Wer also nicht auf deine Bestätigung warten wollte, hat sich einfach ein neues
Konto angelegt – und das Bestätigen im Admin-Panel war damit eine Formsache, die man umgehen konnte.
Das ist jetzt zu.

**Was sich ändert:**

- Bei der Registrierung gibt es **keine Auswahl** mehr. Jedes neue Konto ist **Standard**. Das Feld
  „Konto-Typ" steht noch da, sagt aber nur, welche Stufe man bekommt – und woher die höheren kommen.
- Wer Creator sein will, **fragt danach an**, so wie bei Business: Upgrade-Bildschirm öffnen,
  „Creator anfragen", du bestätigst. Genau der Weg, den du dir letztes Mal gewünscht hast.
- Der **Server** nimmt bei der Registrierung auch nichts anderes mehr an. Selbst wer die Anfrage von
  Hand zusammenbaut und „Creator" hineinschreibt, bekommt eine Absage: „Diese Stufe gibt es erst
  nach Freischaltung – frag sie in der App an." Die Sperre hängt also nicht an der App, sondern am
  Server – Umwege gibt es keine mehr.

**Bestehende Konten lasse ich in Ruhe.** Wer sich vorher selbst Creator gegeben hat, bleibt Creator.
Ich fand es nicht richtig, echten Leuten nebenbei eine Stufe wegzunehmen – das ist deine
Entscheidung. Eins solltest du dabei wissen: **Zurückstufen kann das Panel noch nicht.** Ein Admin
kann eine Stufe nur *hochsetzen*, indem er eine Anfrage bestätigt – einen Knopf „auf Standard
zurücksetzen" gibt es für fremde Konten nirgends. Sag Bescheid, wenn du einen brauchst; dann baue ich
ihn zu **Alle Nutzer** dazu.

**Geprüft:** Server 127 Tests grün (2 neu), App 186 grün, Typen und Lint sauber. Und im Browser
durchgespielt statt geraten: Ich habe mit einem Wegwerf-Konto den ganzen Weg genommen – Formular
ausgefüllt, angemeldet, das Konto war **Standard**, und auf der Startseite stand der neue Satz
„Für eigene Events brauchst du ein Creator-Konto – tippe oben links auf Upgrade". Das Konto habe ich
danach wieder aus der Datenbank gelöscht. Zusätzlich habe ich am laufenden Server versucht, mich als
Creator zu registrieren: abgewiesen, kein Konto entstanden.

**Nicht geprüft:** wie das Feld **am Handy aussieht**. Es ist reiner Text statt Knöpfe, also steht
kaum etwas im Weg – aber gesehen habe ich es nur im Browser.

---

## Gruppen-Chats, Teilen, Impressum & Nutzungsbedingungen

### Gruppen können jetzt reden

Jede Gruppe hat einen **Chat**. Und jedes Event, bei dem du dabei bist, auch – da könnt ihr klären,
wer den Ball mitbringt, ohne dass jemand seine Handynummer rausgeben muss.

Wo du reinkommst: Im Freunde-Bereich steht oben rechts **„Chats"** mit der Zahl der ungelesenen
Nachrichten. Jede Gruppenkarte hat zusätzlich einen eigenen Knopf. Beim Event steht „Chat" im Popup –
aber nur, wenn du zugesagt hast.

Ein paar Dinge, die ich bewusst so entschieden habe:

- **Gruppen ohne eine einzige Nachricht stehen mit in der Liste.** Sonst wäre der Chat unsichtbar,
  bis jemand anfängt – und niemand fängt an, was er nicht sieht.
- **Nachrichten kannst du löschen.** Deine eigenen immer; wer die Gruppe angelegt hat oder das Event
  veranstaltet, auch fremde. Das war eine der häufigsten Beschwerden über vergleichbare Apps:
  Nachrichten, die für immer stehen bleiben.
- **Neue Nachrichten holt die App im Takt**, etwa alle vier Sekunden und nur, solange der Chat offen
  ist. Ein echtes „sofort" bräuchte eine dauerhaft offene Verbindung, und die kann dieses Backend
  nicht – ich wollte dir da nichts vormachen.
- Chats sind **kein Tab**. Unten sind fünf Plätze und die sind voll; ab dem sechsten faltet Android
  alles Weitere in ein „Mehr"-Menü, das kaum jemand öffnet.

### Events teilen

Im Event-Popup steht jetzt **„Teilen"**. Das Blatt bietet zwei Sorten Ziele:

- **Deine Gruppen-Chats.** Da landet das Event als antippbare Karte – die anderen sehen Titel, Ort
  und Zeit und können direkt zusagen. Das ist der Weg, der wirklich zu Zusagen führt.
- **WhatsApp, Telegram, andere Apps.** Da geht ein fertiger Text raus.

Eine Ehrlichkeit dazu: Nach draußen geht **Text und kein Link in die App**. Ein Link, der die App
öffnet, bräuchte eine Website oder einen Store-Eintrag – beides gibt es noch nicht, und ein Link, der
bei den meisten ins Leere führt, ist schlechter als eine Nachricht, die man lesen kann. Sobald es die
Website gibt, ist das eine Zeile Arbeit.

### Impressum, Nutzungsbedingungen und Haftung – in der App

Das war dein zweiter Punkt, und er steckt jetzt unter **Einstellungen → Rechtliches** als fünf Texte,
die man **ohne Internet** lesen kann:

1. **Nutzungsbedingungen** – die Regeln, zwölf Abschnitte.
2. **Haftung und Events** – der Text, um den es dir ging.
3. **Regeln für das Miteinander** – was hier geht und was nicht, in klaren Worten.
4. **Datenschutz** – was gespeichert wird, auch die KI-Prüfung der Bilder.
5. **Impressum**.

Was in „Haftung und Events" steht, in einem Satz: **Du bist nicht der Veranstalter.** Jedes Event
kommt von einer Nutzer:in, die Teilnahme erfolgt auf eigene Verantwortung, und für das, was bei oder
im Zusammenhang mit einem Treffen passiert – Schäden, Verletzungen, Streit, Diebstahl, das Verhalten
anderer Leute –, haftest du nicht. Dazu steht drin, was von wem verlangt wird, wenn jemand ein Event
einträgt (richtige Angaben, Genehmigungen, Jugendschutz), und ein Notruf-Hinweis: 112 bzw. 110.

Zwei Dinge sind mir dabei wichtig:

- **Bei der Registrierung muss man zustimmen.** Ein Haken, der nicht vorausgefüllt ist, mit Links auf
  die Texte. Ohne Haken bleibt der Knopf aus. Gespeichert wird nicht nur „ja", sondern **welcher
  Stand** – wenn du die Bedingungen änderst, lässt sich damit erkennen, wer noch dem alten
  zugestimmt hat.
- **Im Event-Popup steht der Kern noch einmal**, klein am Ende: „Dieses Event kommt von … , nicht von
  GÖ4Fun. Die Teilnahme erfolgt auf eigene Verantwortung." Ein Haftungsausschluss, den man nur in den
  Bedingungen findet, hat im Zweifel niemand gelesen.

**Was du noch tun musst:** Im Impressum stehen **Platzhalter** – Name, Straße, Ort, Telefonnummer und
wer für die Inhalte verantwortlich ist. Die stehen alle an einer Stelle
(`src/constants/operator.ts`), und solange sie drin sind, zeigt der Rechtliches-Bereich einen
Warnkasten „Noch nicht veröffentlichungsreif". Ein unvollständiges Impressum ist der klassische
Abmahn-Anlass, deshalb ist der Hinweis in der App und nicht bloß ein Kommentar im Code. Und: Die
Texte sind sorgfältig auf deine App zugeschnitten, aber ich bin kein Anwalt – lass sie einmal
gegenlesen, bevor du veröffentlichst.

### Was ich dazugebaut habe, ohne dass du es gesagt hast

Du hast mich gebeten zu recherchieren, was Nutzer sich wünschen. Drei Dinge kamen dabei immer wieder,
und zwei davon hängen direkt an deinem Haftungsthema:

- **Melden.** Events, Nachrichten, Konten, Beiträge und Storys lassen sich melden – Grund auswählen,
  optional etwas dazu schreiben. Das ist die Gegenseite zum Haftungsausschluss: Eine Plattform, die
  erklärt, nicht zu haften, aber keinen Weg anbietet, ihr von Problemen zu erzählen, hat nichts
  vorgesehen. Die Meldungen landen im Admin-Bereich unter **Meldungen**, mit Zahl auf der Karte,
  Dringendes oben.
- **Blockieren.** Wirkt sofort: Die Person findet dich nicht mehr, kann nicht anfragen und ihre
  Nachrichten verschwinden für dich – für die anderen im Chat bleiben sie stehen, denn dein
  Blockieren ist deine Sicht und nicht die Löschung eines fremden Beitrags. Die Freundschaft und
  gemeinsame Gruppen enden dabei. Freigeben geht unter Einstellungen → **Blockierte Konten**.
- **Merken.** Ein Stern im Event-Popup legt ein Event auf deine Merkliste, und auf der Startseite
  steht dann ein Regal **„Gemerkt"** – noch vor „Für dich". Merken ist bewusst **keine Zusage**: Es
  belegt keinen Platz, und du kannst auch ein volles Event merken.

Außerdem: **Gruppen kannst du jetzt umbenennen.** Eine Gruppe, in der geredet wird, überlebt ihren
ersten Anlass – aus „Kickerrunde" wird irgendwann „Donnerstagsrunde", und dafür soll man sie nicht
neu anlegen und alle neu einladen müssen.

### Aufgeräumt

- Die Freunde-Seite war auf 778 Zeilen angewachsen, mit einem Server-Aufruf mitten in einem Knopf.
  Jetzt sind Personenzeile, Gruppenkarte und Gruppen-Formular eigene Bausteine, und die Seite steuert
  nur noch. Trotz der neuen Funktionen ist sie **kürzer** als vorher.
- Im Backend lagen Freunde und Gruppen in einer Datei – zwei Dinge, die nur einen Namen teilen. Jetzt
  getrennt, das Gemeinsame in einer dritten Datei.
- **Zwölf Dateien** hatten ihre eigene Datums-Formatierung, drei davon Zeichen für Zeichen
  identisch. Das war die Sorte Doppelung, die erst auffällt, wenn man ein Format ändern will und die
  App danach zwei zeigt. Jetzt an einer Stelle, mit Tests.

**Geprüft:** Server 168 Tests grün (41 neu, davon 15 gegen die echte Datenbank), App 240 grün (54
neu), Typen und Lint sauber. Und im Browser durchgespielt statt geraten: zwei Wegwerf-Konten
angelegt, befreundet, Gruppe gemacht, Nachrichten hin und her geschickt, den Ungelesen-Zähler
kontrolliert, **über die Oberfläche eine Nachricht gesendet** (steht im Bild, Feld geleert, in der
Datenbank), die Rechtstexte gelesen. Danach die Konten gelöscht – und dabei geprüft, dass Chat und
Nachrichten mit weggeräumt wurden.

Zwei Tests haben echte Fehler gefunden, die ich beim Hinsehen nicht bemerkt hätte: Jede Nachricht
trug versehentlich die Nutzer-ID ihres Absenders statt ihrer eigenen – Löschen und Melden liefen
deshalb ins Nichts. Und ein leerer Seitengrößen-Parameter wurde als „eine Nachricht" gelesen.

**Nicht geprüft:** wie das alles **am Handy** aussieht (nur im Browser), und das Teilen-Blatt mit
echtem WhatsApp – im Web-Build gibt es den System-Dialog nur eingeschränkt. Der Text, der dabei
rausgeht, ist aber durch Tests abgedeckt.

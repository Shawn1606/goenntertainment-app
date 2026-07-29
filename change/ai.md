# CHANGE LOG — AI-optimiert (dicht, scannbar)

> Zweck: schnelle Kontext-Wiederherstellung für eine KI. Neueste Einträge unten.
> Format je Schritt: STEP · repo · branch/PR · files[] · decisions[] · tests[] · open[]

repos:
  app: goenntertainment-app (Expo SDK 54, expo-router, TS, RN 0.81)  <-- DIESES repo
  backend: goenntertainment (Laravel 13, PHP 8.4, Sanctum)
constraints:
  - Expo SDK 54 hart (User Expo Go max 54). AGENTS.md nennt v57 => FALSCH, ignorieren.
  - Backend bleibt reines API-Backend; App-Code nur hier.
  - Bash-cwd springt auf Laravel-Ordner zurück => in jedem Befehl `cd .../goenntertainment-app`.
  - Persistenter Server: PowerShell Start-Process (nicht Start-Job; stirbt mit Prozess).
  - Screenshot im Browser-Pane nicht möglich => Verifikation via read_page + JS-Geometrie.

---

STEP 1 · backend · PR #22 (goenntertainment) MERGED->main
files:
  + app/Http/Controllers/Api/AuthController.php (register,login,logout,user)
  + app/Http/Controllers/Api/GoogleAuthController.php (store: Socialite stateless userFromToken)
  + app/Http/Requests/Api/{Register,Login,GoogleLogin}Request.php
  + routes/api.php ; config/cors.php ; config/sanctum.php ; migration personal_access_tokens
  ~ app/Models/User.php (HasApiTokens) ; bootstrap/app.php (api routing) ; .env.example (FRONTEND_URL)
api:
  POST /api/register {name,username,email,password,account_type,interests?,device_name} -> {user,token,profile_complete} 201
  POST /api/login {email,password,device_name} -> {user,token,profile_complete}
  POST /api/logout (Bearer) -> {message}
  GET  /api/user (Bearer) -> {user,profile_complete}
  POST /api/auth/google {access_token,device_name} -> {user,token,profile_complete}
auth: Sanctum Bearer token. CORS origins = env FRONTEND_URL (default *), credentials off.
decisions:
  - register interests OPTIONAL (kein /api/interests endpoint vorhanden)
  - login: Hash::check + __('auth.failed'); kein password_confirmation in API
tests: pint baseline 4->3; pest 14/14; real HTTP /user=401 /login-bad=422
open: Google braucht eigenen OAuth-Client (User, Google Cloud Console)

STEP 2 · app · PR #1 (goenntertainment-app) branch feature/auth-screens · OPEN
goal: Auth-Flow (E-Mail) + Home in App gegen STEP-1 API
deps+: expo-secure-store
files:
  + src/lib/api.ts (fetch client, ApiError{status,errors,firstError}, types User/AuthResult)
  + src/lib/token-store.ts (secure-store native / localStorage web, key goenn_api_token)
  + src/lib/auth-context.tsx (AuthProvider: bootstrap loadToken->/user, login/register/logout, useAuth)
  + src/constants/config.ts (API_URL; guessDevHost aus Constants.expoConfig.hostUri + :8000)
  ~ src/app/_layout.tsx (AuthProvider + ThemeProvider@react-navigation/native + Stack.Protected guard=!!token)
  + src/app/(auth)/_layout.tsx (Stack) ; (app)/_layout.tsx (AppTabs)
  + src/app/(auth)/index.tsx=Welcome, login.tsx, register.tsx
  mv src/app/index.tsx -> (app)/index.tsx (Home + echte Userdaten + logout) ; explore.tsx -> (app)/explore.tsx
routing: groups (auth)/(app); Gate via Stack.Protected; login/register success => gate flippt automatisch
decisions:
  - ThemeProvider import von @react-navigation/native (nicht expo-router; canonical, tsc-clean)
  - RN Animated statt reanimated (kein babel-plugin nötig)
tests: bundle android=200; tsc clean own; browser: register->home, logout->welcome, login->home; CORS ok
note: erzeugt DB-Testuser expotest01@example.com / geheim1234 (dev)

STEP 3 · app · PR #1 (gleicher branch, commit nach STEP 2)
goal: altes Web-Marken-Design + Login-Overlay portieren
deps+: react-native-svg, expo-linear-gradient, @react-native-masked-view/masked-view
files:
  + src/components/goenn-background.tsx (SVG: 1 linear base + 3 radial blobs = goenn-bg)
  + src/components/brand-gradient-text.tsx (MaskedView+LinearGradient; web-fallback solid #9b6dff)
  + src/components/auth-illustration.tsx (Maskottchen: 5 badge-icons row + 6-circle community svg, #a78bfa/.7)
  + src/components/login-sheet.tsx (bottom-sheet overlay, Animated translateY, backdrop, login form)
  + src/components/ui/brand-button.tsx (LinearGradient purple->pink) ; brand-text-field.tsx (helle inputs)
  ~ src/constants/theme.ts (+Brand{purple#9b6dff,pink#ff6bb5,peach#ffb4a2,lavender#e8d5ff,...}, BrandGradient)
  ~ src/app/(auth)/index.tsx (Welcome neu: hero+mascot+Anmelden->sheet) ; register.tsx (auf Brand umgestellt)
  - src/app/(auth)/login.tsx (weg: Login lebt im Sheet wie Web-Original)
  - src/components/ui/primary-button.tsx, text-field.tsx (tot nach login.tsx-Entfernung)
decisions:
  - keine separate /login route mehr; register "Zum Login" -> router.replace('/')
  - Brand-Screens immer hell/pastell (wie Web), unabhängig vom Dark-Mode
tests: web bundle=200; tsc clean own; browser sheet-login->home; JS-geometry: bg-svg 1280x720/4rects,
       5 badges 20x20, mascot 320x110 6circles, brand color rgb(155,109,255); 0 console errors
open:
  - Home (app)/index.tsx NICHT auf Pastell-Thema umgestellt (nutzt Tab-Theme)
  - Google-Login App-Seite; Interessen-Auswahl (+/api/interests); Passwort-vergessen; Activities aus API

STEP 4 · app · PR #1 · User-Feedback Welcome-Screen
files:
  ~ src/app/(auth)/index.tsx (Welcome umgebaut)
  ~ src/components/auth-illustration.tsx (+size prop 'normal'|'large')
changes:
  - Brand-Titel: "GÖ" gross (fontSize 68) + Rest 40, grosses Ö => "GÖnntertainment" (BrandGradientText mit nested Text)
  - Anmelde-Button ENTFERNT; Öffnen nur via Hochwischen (PanResponder onMoveShouldSet dy<-12, release dy<-40) + Tap auf Hinweis
  - Hinweistext klarer: "↑ Nach oben wischen zum Anmelden"
  - Maskottchen size="large" (badges 52, community-svg h160, maxWidth 420) + Layout: Titel oben, Maskottchen unten (spacer flex:1), nicht mehr alles zentriert
  - grauer bottomHandle-Strich ENTFERNT
tests: web bundle 200; tsc clean own; JS: GÖ=68px lila, community 420x160 top~452/720; sheet-login->home ok (hasToken true)
note: browser-tool ref/coord-klick auf RN-web Pressable+LinearGradient unzuverlaessig; echter DOM-.click() bzw. Handy-Tap loest onPress korrekt aus (kein bug)

STEP 5 · app · PR #1 · Rename "Gönntertainment" -> "GÖ4Fun"
grund: alter Name zu lang; User waehlt GÖ4Fun (GÖ=gönn, 4Fun=for Fun); GÖ muss herausstechen
files:
  ~ src/app/(auth)/index.tsx (Welcome-Titel: <Text brandGoe 68px>GÖ</Text>4Fun)
  ~ src/app/(app)/index.tsx (Home-Kopf: GÖ 22px/800 + 4Fun)
tests: web bundle 200; tsc clean; JS: Welcome GÖ=68px, Home GÖ=22px, alter Name weg
note: app.json name/slug (goenntertainment-app) NICHT geaendert (nur Anzeige-Titel)

STEP 6 · app · PR #1 · Logo-Wortmarke + animierter Hintergrund
files:
  + src/components/brand-logo.tsx (BrandLogo size large|small: GÖ BrandGradientText + "4" LinearGradient-Badge + "Fun" dunkel/800)
  ~ src/components/goenn-background.tsx (statische SVG-Blobs -> LinearGradient-Basis + 4 animierte Orb-Kugeln)
  ~ src/app/(auth)/index.tsx (BrandLogo statt Inline-Titel; brand/brandGoe styles weg)
  ~ src/app/(app)/index.tsx (Home-Kopf: BrandLogo size=small)
animation: Orb = Animated.View(translateX/Y, interpolate 0->dx/dy) + Svg RadialGradient-Circle; Animated.loop(sequence up/down), Easing.inOut(ease), useNativeDriver: Platform.OS!=='web'
tests: web bundle 200; tsc clean; JS: Logo-Teile GÖ/4/Fun da, 4 orbs vorhanden
KNOWN-LIMIT: Bewegung im Test-Browser NICHT verifizierbar — Pane versteckt => requestAnimationFrame pausiert => JS-Driver tickt nicht (rAF-Zähler-Test lief 0 Frames/Timeout). Auf Handy (native driver) laeuft es. Nur statisch/strukturell geprueft.
open (unveraendert): Home-Pastell-Thema, Google-Login, Interessen, Passwort-vergessen, Activities

STEP 7 · app · PR #1 · Logo flowy + Hintergrund nach Referenz
grund: User: Badge-Logo schlecht, will "flowy"; Hintergrund aus Referenz-Screenshot (Pfirsich oben rechts, lila Wellen unten) + animiert
files:
  ~ src/components/brand-logo.tsx (Badge RAUS; jetzt GÖ Verlauf 800 + "4Fun" grau #a8a2b5 600, gleiche fontSize, flowy Zweiton)
  ~ src/components/goenn-background.tsx (Orbs-only RAUS -> Referenz-Look: LinearGradient-Basis #fdf1ec/#faf0f6/#efe4f7 + Pfirsich-RadialGradient oben rechts + 2 kleine Orbs (purple links, peach rechts) + 3 lila Wellen unten (Wave: Svg Path preserveAspectRatio none, Animated translateX +-amp, dur 7-9s))
tests: web bundle 200; tsc clean; JS: GÖ lila 46px + 4Fun grau 46px (Badge weg), 3 Wellen-Paths, 12 svgs
KNOWN-LIMIT: Wellen-Bewegung im versteckten Test-Pane nicht sichtbar (rAF pausiert); laeuft am Geraet

STEP 8 · app · PR #1 · Logo als fliessende Script-Schrift
grund: User will flowy Schrift-Look wie "flow healing arts"-Logo (verbundene Script), Name GÖ4Fun bleibt
deps+: @expo-google-fonts/pacifico (bundled font)
files:
  ~ src/app/_layout.tsx (useFonts({Pacifico_400Regular}); Splash wartet bis fontsReady && !isBootstrapping)
  ~ src/components/brand-logo.tsx (Zweiton RAUS -> ein Wortbild "GÖ4Fun" in fontFamily Pacifico_400Regular + BrandGradientText, fontSize 54/24, lineHeight *1.45)
tests: web bundle 200; tsc clean; JS: logo fontFamily=Pacifico_400Regular 54px, document.fonts hat pacifico=true
note: GÖ sticht durch Grossbuchstaben im Script heraus; Verlauf via MaskedView (native), Web-Fallback solid lila

STEP 9 · app · branch fix/create-activity-remount · Bugfix Event-Formular + Datum TT.MM
grund: User (Handy): Foto-Auswahl wird sofort geloescht, Tastatur schliesst bei jedem Zeichen,
       Interessen laden nie. Diagnose per Ausschluss: Problem NUR im Event-Screen, Login/Register ok
       => nicht reactCompiler (traefe alle Screens), sondern presentation:'modal'.
ursache: _layout.tsx:31 Stack.Screen create-activity mit presentation:'modal'. Android baut den
       Modal-Screen bei jeder Tastatur-/Layout-Aenderung neu auf => lokaler State (banner, interests-
       Ladezustand) + TextInput-Fokus gehen verloren. Register (normaler Screen) daher unauffaellig.
files:
  ~ src/app/_layout.tsx (presentation:'modal' entfernt; create-activity ist jetzt normaler Push-Screen,
     eigener Header bleibt via Stack.Screen im Screen selbst)
  ~ src/app/create-activity.tsx (Datum jetzt TT.MM ohne Jahr: DATE_RE /^(\d{1,2})\.(\d{1,2})$/;
     toIso setzt Jahr automatisch = aktuelles Jahr, bei vergangenem Tag/Monat naechstes Jahr;
     placeholder + Fehlermeldung auf TT.MM)
decisions:
  - reactCompiler NICHT angefasst (nicht die Ursache; weniger Aenderung = besser)
  - Datum ohne Jahr auf User-Wunsch; +1-Jahr-Fallback verhindert Events in der Vergangenheit
tests: tsc: eigene Dateien clean (restliche Fehler vorbestehend = Beta-SDK-Typen app-tabs/explore/use-theme)
verify-open: Handy-Test durch User (Android-Remount nur am Geraet reproduzierbar, nicht auf Web)
open (weiter offen, eigene Tickets): Interessen bei Kontoerstellung (register.tsx); expo-image-picker
     als Plugin in app.json (fuer gebauten Build noetig); Event beitreten; Datums-Picker

STEP 10 · meta · Richtungswechsel im Workflow (User-Entscheidung 2026-07-25)
grund: User-Vorgabe: ab jetzt AUSSCHLIESSLICH in diesem App-Projekt arbeiten.
entscheidung: Backend wird komplett von PHP/Laravel nach JS/TS hierher migriert
       (Expo-Router API-Routes). Ziel: Laravel voll abloesen.
       Laravel = nur noch Uebergangs-Datenquelle/Vorlage, kein Feature/Fix mehr dort.
       Rueckverfolgung laeuft nur noch hier (change/ai.md + change/human.md).
       Checks: expo lint + tsc + JS-Tests statt Pint/Pest.
files:
  ~ CLAUDE.md (App) — neuer Abschnitt "0. RICHTUNGSWECHSEL" + Workflow/5-Regeln uebernommen
  ~ ../goenntertainment/CLAUDE.md (Laravel) — gleicher "0. RICHTUNGSWECHSEL"-Block oben ergaenzt
offen (eigene Tickets): Backend-Umbau selbst (Auth/Google-Login, Activities, Teilnehmer/Beitreten)
       Stueck fuer Stueck in JS neu; Entscheidung ueber offenen Laravel-PR #25 (Beitreten-API)

STEP 11 · backend · branch feature/backend-node-migration · Restliche Laravel-Teile nach JS portiert
grund: User-Wunsch: alles was ins App-Projekt passt aus Laravel hierher ziehen und sichtbar machen.
befund: Controller (Auth/Google/Interests/Activities inkl. join/leave) waren bereits in server/src
        portiert. Es fehlten noch: DB-Schema, Seeds, Passwort-Reset.
files:
  + server/schema.sql            (alle Tabellen aus den Laravel-Migrations; CREATE TABLE IF NOT EXISTS;
                                  users inkl. Profilfelder, interests, interest_user, activities,
                                  activity_interest, activity_user, personal_access_tokens,
                                  password_reset_tokens; FKs mit ON DELETE CASCADE)
  + server/src/seed.js           (portiert InterestSeeder + AdminUserSeeder; idempotent via
                                  ON DUPLICATE KEY / SELECT-dann-UPDATE; slugify wie Str::slug;
                                  Admin nur wenn ADMIN_EMAIL/ADMIN_PASSWORD gesetzt)
  + server/src/routes/password.js (POST /api/forgot-password + /api/reset-password; Token gehasht in
                                  password_reset_tokens, 60-Min-Ablauf, neutrale Antwort ohne Leak)
  ~ server/src/index.js          (passwordRouter unter /api eingehaengt)
  ~ server/package.json          (script "seed": node src/seed.js)
  ~ server/.env.example          (ADMIN_EMAIL/ADMIN_PASSWORD ergaenzt)
decisions:
  - schema.sql idempotent (IF NOT EXISTS) => gefahrlos gegen bestehende Laravel-DB.
  - Passwort-Reset auf DB-Ebene komplett; ECHTER Mail-Versand (SMTP) bleibt eigenes Ticket,
    Token wird bis dahin nur in die Server-Konsole geloggt.
tests (echt, Port 8077, gegen laufende MySQL):
  - health OK; forgot: neutral bei Unbekannt, 422 bei ungueltiger Mail
  - Happy-Path mit Wegwerf-Nutzer: register -> forgot (Token aus Log) -> reset -> login neu OK,
    login alt abgelehnt; Testnutzer danach geloescht
  - reset mit falschem Token -> 422
  - seed idempotent: interests bleiben 10, keine Duplikate (Slugs matchen Laravel-Daten)
  - schema.sql fehlerfrei gegen DB ausgefuehrt (No-Op dank IF NOT EXISTS)
offen (eigene Tickets): SMTP-Mailversand fuer Reset; forgot-password.tsx an /api/forgot-password
    anbinden (Screen zeigt bisher nur eine neutrale Bestaetigung ohne echten Aufruf)

STEP 12 · app · branch feature/backend-node-migration · App an neues Backend gebunden
files:
  ~ src/lib/api.ts            (api.forgotPassword -> POST /api/forgot-password)
  ~ src/app/(auth)/forgot-password.tsx (onSubmit ruft jetzt echt api.forgotPassword; loading+Fehler)
  ~ src/constants/config.ts   (Kommentar: Laravel -> JS-Backend server/, Start via npm run dev)
tests: tsc sauber fuer geaenderte Dateien; expo lint ohne Meldung fuer diese Dateien
       (uebrige Lint/tsc-Fehler vorbestehend in create-activity, Beta-SDK-Typen)
note: join/leave bewusst NICHT im Client ergaenzt (kein Screen als Konsument -> waere toter Code)

STEP 13 · ops/docs · branch main · Fix: App konnte Backend nicht erreichen (Server nicht gestartet)
symptom: App laedt keine Accounts/Activities; ApiError "Keine Verbindung zum Server." (status 0)
root-cause:
  - Nach Laravel->Node-Migration muss server/ manuell gestartet werden (kein Herd-Autostart mehr).
  - Nichts lauschte auf :8000. MySQL (Herd) lief korrekt auf :3306 (Diagnose anfangs verfaelscht
    durch dt. netstat-Locale: "ABHOEREN" statt "LISTENING").
diagnosis (echt, gegen laufende MySQL + kurz gestartetes Backend):
  - :3306 mysqld ABHOEREN (Herd) OK; :8000 nicht vorhanden.
  - node src/index.js startet sauber; GET /api/health {ok:true}; GET /api/interests 10 Eintraege;
    POST /api/login liefert korrekte 422 bei falschen Daten.
  - DB-Zaehlung via mysql2: users=5, activities=1, interests=10. => Daten vorhanden, kein Code-Bug.
  - git show HEAD -- config.ts: nur Kommentare geaendert (kein funktionaler Regress).
files:
  ~ package.json          (scripts: "server" -> npm --prefix server run dev; "server:seed")
  ~ README.md             (Get started: Backend zuerst starten; Verweis auf change/human.md)
  ~ change/human.md,ai.md (Doku)
decisions:
  - Kein concurrently/neue Dep: Zwei-Terminal-Flow (Backend + expo) bleibt, nur bequemer per
    Root-Script. server/.env war bereits korrekt (DB_PASSWORD gesetzt) -> nicht angefasst.
tests: npm run server startet Backend; /api/health OK nach Start.

STEP 14 · server/perf · branch main · Backend-Latenz: localhost-IPv6 + blockierendes bcrypt behoben
symptom: "Backend unfassbar langsam".
diagnose (gemessen):
  - 127.0.0.1/api/health ~5ms; localhost/api/health connect=209ms (Windows loest localhost
    zuerst auf ::1 auf, Server band nur 0.0.0.0 -> IPv6-Fehlversuch + Fallback).
  - bcryptjs cost12 SYNC: compareSync 313ms, hashSync 317ms -> blockt Event-Loop (alle Requests).
  - activities-Query sauber (kein N+1); DB via 127.0.0.1 schnell -> nicht die DB.
fixes:
  ~ server/src/index.js   listen('::') statt '0.0.0.0' => Dual-Stack; localhost 210ms -> ~4ms.
  ~ server/src/auth.js    checkPassword/hashPassword async (bcrypt.compare/hash), ROUNDS 12->10.
  ~ server/src/routes/auth.js      register/login: await hashPassword/checkPassword.
  ~ server/src/routes/password.js  forgot/reset: await hash/compare (3 Stellen).
  ~ server/src/seed.js             await hashPassword.
verifiziert (echt, via npm-Start cwd=server, gegen laufende MySQL):
  - localhost/health total ~4ms (vorher ~210).
  - register 201 131ms; login 200 85ms; login-falsch 422 82ms; Testnutzer danach geloescht.
gotcha: server NUR mit cwd=server starten (npm run server). Manueller Start aus Repo-Root laedt
  dotenv aus Root -> kein DB_PASSWORD -> ER_ACCESS_DENIED (using password: NO). War Testfehler,
  kein Code-Bug.
decisions: cost 10 = Laravel-Default, weiterhin sicher, ~4x schneller als 12. Bewusst KEIN
  natives bcrypt / kein concurrently (keine neue Dep-Baustelle).

STEP 15 · app/config · branch fix/backend-connectivity-and-perf · Login-Timeout: falsch gerateter API-Host
symptom: "einloggen dauert ewig" am echten Handy (Expo Go). Backend selbst ~4ms.
diagnose:
  - Expo-Manifest hostUri = 127.0.0.1:8081 -> guessDevHost() => http://127.0.0.1:8000
    (aus Handy-Sicht = das Handy selbst).
  - PC hat 2 externe IPv4: Hamachi 25.36.112.94 (ZUERST) vor WLAN 192.168.178.25.
    LAN-Guess wuerde die VPN-IP nehmen -> vom Handy nicht/langsam erreichbar -> TCP-Timeout.
  - Server bindet '::' + 0.0.0.0, auf 192.168.178.25:8000 lokal 200/4ms erreichbar (keine Regression).
fix:
  ~ src/constants/config.ts  HARDCODED_API_URL = 'http://192.168.178.25:8000' (Raten abgeschaltet).
offen/Hinweis (kein Code): Windows-Firewall fuer Node/Port 8000 inbound (private) muss erlaubt sein;
  Handy im selben 192.168.178.x-WLAN. Phone-Test: GET http://192.168.178.25:8000/api/health.
  Bei wechselnder PC-IP config.ts anpassen (langfristig: guessDevHost koennte 192.168/10.x vor
  VPN-Ranges bevorzugen -> eigenes Ticket).

STEP 16 · backend+app · branch main · KI-Verifizierung (Jugendschutz) + Auto-Timeout 7 Tage
goal: Titel, Beschreibung, Interessen und Banner-Bild jeder neuen Aktivitaet per Claude auf
      "jugendfrei" pruefen; nicht jugendfreie Inhalte ablehnen und das Konto automatisch
      7 Tage sperren (mit Beweis + nachvollziehbarem Bericht im Admin-Panel).
deps+: @anthropic-ai/sdk ^0.115.0 (nur server/)
files:
  + server/src/moderation.js   (Kern: classify() 1 Claude-Call mit Structured Output ->
      VERDICT_SCHEMA {youth_safe, severity 0-3 (enum, weil minimum/maximum nicht unterstuetzt),
      categories[], fields[], reason}; decide() -> Massnahme; saveReport(); Auto-Timeout;
      moderateActivity() = oeffentliche API; fieldErrorsFor() mappt KI-Felder auf Formularfelder;
      interestNames() liest Interessen-Klartext)
  ~ server/src/auth.js         (+setBan, +recordBanEvidence — aus admin.js hochgezogen, damit
      Admin-Panel und KI-Moderation denselben Sperr-Pfad nutzen; recordBanEvidence bekommt `source`)
  ~ server/src/routes/activities.js (POST /: nimmt custom_interests[] an (nur zur Pruefung, nicht
      in DB); Pruefung VOR Banner-Speichern + INSERT; 422 mit Feldfehlern bzw. 403 + {ban, moderation})
  ~ server/src/routes/admin.js (setBan/recordEvidence entfernt -> aus auth.js; GET /admin/moderation
      (Berichte + totals, ?only=flagged); /admin/evidence liefert jetzt `source`)
  ~ server/src/db.js           (ensureSchema: +moderation_reports, +ban_evidence (nachziehen),
      +hasColumn() und idempotenter ALTER fuer ban_evidence.source; MySQL 8 kennt kein
      ADD COLUMN IF NOT EXISTS)
  ~ server/schema.sql          (+moderation_reports, ban_evidence.source)
  ~ server/src/index.js        (Startlog moderationStatus(); Router-Kommentar)
  ~ server/.env.example        (ANTHROPIC_API_KEY, MODERATION_* Schalter)
  ~ src/lib/api.ts             (+AdminModerationReport/AdminModeration, +api.adminModeration,
      AdminEvidence.source, CreateActivityInput.customInterests, createActivity schickt
      custom_interests[] und gibt jetzt den ganzen Fehler-Body in ApiError (fuer body.ban))
  ~ src/app/create-activity.tsx (customInterests mitschicken; 403+body.ban -> Alert mit Grund/Ende
      und lokales logout(), weil der Token serverseitig entwertet ist; fmtBanUntil())
  + src/app/admin-moderation.tsx (Admin-Screen: KPIs geprueft/abgelehnt/Sperren/Fehler,
      Umschalter "nur Auffaelligkeiten"/"alle", pro Bericht Schwere+Kategorien+Begruendung+
      Schnappschuss+Bild mit Zoom)
  ~ src/app/_layout.tsx        (Stack.Screen admin-moderation im geschuetzten Bereich)
  ~ src/app/(app)/admin-panel.tsx (Einstieg "🤖 KI-Verifizierung")
  ~ src/app/(app)/admin-evidence.tsx (kennzeichnet source==='ai' als automatisch)
api:
  POST /api/activities  +custom_interests[]  -> 422 {message, errors{title|description|interests|banner}}
      bei Ablehnung ohne Sperre; 403 {message, ban{reason,permanent:false,banned_until}, moderation
      {severity,categories,fields,reason}} bei Ablehnung MIT Auto-Sperre
  GET  /api/admin/moderation[?only=flagged] -> {totals{checked,blocked,timeouts,errors}, data[]}
policy/decisions:
  - Modell claude-opus-5 (Vision + Text in einem Call), output_config.effort='low',
    max_tokens 4096 (Thinking ist auf Opus 5 standardmaessig AN und zaehlt gegen max_tokens).
  - Structured Outputs statt Prompt-"gib JSON" -> Parsing kann nicht scheitern.
  - Server-seitige Fallbacks an (betas ['server-side-fallback-2026-07-01'] + fallbacks:'default'):
    Moderations-Inhalte koennen vom Sicherheits-Klassifikator abgelehnt werden, dann antwortet
    ein Ersatzmodell. Ist das fuer den Account nicht frei, wird der Weg bei 400 einmalig
    deaktiviert und ohne Fallback weitergemacht (kein harter Ausfall).
  - Schwellen (env): BLOCK_SEVERITY=2 (ablehnen), TIMEOUT_SEVERITY=2 (+7 Tage Sperre),
    TIMEOUT_DAYS=7. Schwere 1 (grenzwertig) geht bewusst DURCH und wird nur protokolliert
    -> keine Fehlsperren bei derber Sprache/Alkohol.
  - Admins werden NIE automatisch gesperrt (sonst sperrt sich das Team selbst aus dem Panel).
  - refusal (Klassifikator lehnt Pruefung ab) -> Inhalt ablehnen, aber NICHT sperren
    (Sperre ohne nachvollziehbare Begruendung waere unfair).
  - API-Ausfall -> MODERATION_FAIL_OPEN=true (Standard) laesst durch + protokolliert 'error';
    false lehnt ab. Bewusst fail-open, damit ein Anthropic-Ausfall nicht die App lahmlegt.
  - Prompt-Injection: Nutzereingaben stehen in <inhalt>-Klammern, System-Prompt erklaert sie
    explizit als Daten und benennt Manipulationsversuche als solche.
  - Bild wird NUR bei einer Auto-Sperre nach storage/evidence/ geschrieben (Beweis fuer den
    Admin); sonst nie gespeichert. Abgelehnte Banner landen nie in storage/banners.
  - Selbst eingetippte Interessen bleiben nicht-persistent (wie bisher), gehen aber zur Pruefung
    mit: sie sind der einzige freie Text bei den Interessen (DB-Liste ist kuratiert).
  - moderation_reports.user_id -> ON DELETE SET NULL, damit Berichte eine Konto-Loeschung ueberdauern.
tests (echt, Port 8077, gegen laufende MySQL; Anthropic-API per lokalem Mock auf 8099 ueber
  ANTHROPIC_BASE_URL — kein API-Key in der Dev-Umgebung, das Modell-Urteil selbst ist also
  NICHT live geprueft): 30/30 Checks gruen —
  Schwere 0 -> 201; Schwere 1 -> 201 + Bericht 'auffaellig'; Schwere 2 -> 403 + Sperre 7.00 Tage
  + ban_evidence(source=ai,action=timeout) + Beweisbild auf Platte + Bericht 'abgelehnt/timeout';
  Token danach entwertet (401); Login zeigt Sperrgrund; Bild wirklich als base64-Block gesendet;
  Titel/Beschreibung/Interessen im Prompt; output_config.format=json_schema; Fallback-Beta-Header
  gesetzt; refusal -> 422 ohne Sperre; API-Ausfall -> 201 + Bericht 'error';
  GET /admin/moderation (totals + only=flagged); /admin/evidence source=ai.
  Regression ohne Key: Log "KI-Moderation: AUS", Event 201, keine Berichte.
  tsc: nur 2 vorbestehende Fehler (animated-icon, collapsible); expo lint: nur 1 vorbestehender
  Fehler (activity-map.web.tsx).
offen (eigene Tickets):
  - Kosten/Latenz: pro Event 1 Opus-5-Call mit Bild (bis ~4.8k Bild-Tokens). Guenstiger waere
    claude-haiku-4-5 via MODERATION_MODEL oder Vorfilter (Bild verkleinern; server hat kein sharp).
  - Bearbeiten bestehender Events wird nicht geprueft (es gibt noch kein PATCH /activities/:id).
  - Profil (Name/Benutzername) und Avatare werden nicht geprueft.
  - Kein Einspruchs-/Review-Flow: Admin kann nur ueber /admin/users entsperren.
  - Berichte werden nie aufgeraeumt (LIMIT 200 in der Liste, Tabelle waechst unbegrenzt).

STEP 17 · app+backend · branch main · Board-Tickets #2/#5/#6/#9/#17/#18 + Glas-Design + TDD-Basis
grund: User-Auftrag "Tickets vom Board umsetzen, Funktionen ausbauen, Glas-Look wie cira.systems,
       Kundenprobleme recherchieren, nach SOLID+TDD arbeiten".
board (gh project item-list 2 --owner Shawn1606): 18 Items, #1 und #3 Done, Rest Backlog.
recherche (WebSearch/WebFetch, Quellen in change/human.md Abschnitt 15):
  - Meetup-Kritik #1 = unzuverlaessige Zusagen/No-Shows; #2 = "finde nichts Passendes" +
    schlechte Karten/Entfernungen; #3 = clunky Navigation, langsame Bilder, Werbung.
  - Studenten-Apps (Popple/Campus-Apps): Interessen-Matching, Filter nach Datum/Typ/Ort,
    kleine Gruppen, Sicherheit/Verifizierung als Kaufargument.
  - cira.systems: minimal, viel Weissraum, ein Akzent, dezente Elevation, DSGVO/Vertrauen.
  => umgesetzt: Suche/Filter, echte Entfernung, selbst erweiternder Umkreis, Empfehlungs-Scoring,
     XP nur fuer echtes Mitmachen (No-Show-Thema). Zuverlaessigkeits-Quote = offenes Ticket.

architektur (SOLID):
  + src/domain/*  NEUE framework-freie Schicht (kein React/RN/fetch, nur relative Imports).
      Dadurch mit `node --test` direkt lauffaehig (Node 26 liest TS nativ) und in jeder
      Schicht wiederverwendbar. Strukturelle Typen (FilterableActivity/RecommendableActivity)
      statt Import der API-Typen => Domaene kennt die API nicht (DIP/ISP).
  + server/src/app.js  createApp() aus index.js herausgeloest (SRP): Tests ziehen die App auf
      Port 0 hoch, index.js macht nur noch listen + ensureSchema + prune.
  - Duplikat entfernt: haversine lag in use-nearby-activities.ts, jetzt src/domain/distance.ts.

files (neu):
  + src/domain/distance.ts|.test.ts        (haversine + formatDistance "350 m"/"1,2 km"/"35 km")
  + src/domain/activity-filter.ts|.test.ts (EMPTY_FILTER, normalize (ss/NFD), activeFilterCount,
      filterActivities: Query x Kategorie x Zeitfenster x Umkreis x hideFull, UND-verknuepft)
  + src/domain/recommendations.ts|.test.ts (WEIGHTS, scoreActivity, rankActivities (stabil),
      explainMatch)
  + src/domain/nearby.ts|.test.ts          (RADIUS_STEPS_KM [30,60,120,240] + chooseRadius)
  + src/domain/gamification.ts|.test.ts    (XP, LEVELS, levelFor, BADGE_RULES als Daten, badgesFor)
  + src/components/ui/glass.tsx            (GlassSurface/GlassCard/GlassChip/GlassButton/
      GlassSearchField/SectionHeader/GlassProgressBar)
  + src/components/activity-filter-bar.tsx (Suchfeld + Chip-Reihen; nur Darstellung)
  + src/app/progress.tsx                   (Level, Abzeichen, Rangliste)
  + server/src/app.js, server/src/gamification.js, server/src/routes/progress.js
  + server/test/gamification.test.js, server/test/api.test.js
files (geaendert):
  ~ src/constants/theme.ts   (+Glass light/dark: fill/fillStrong/fillSubtle/border/edge/
      highlight/shadow/tint; +Radius chip|field|card|panel)
  ~ src/hooks/use-theme.ts   (+useGlass())
  ~ src/lib/use-nearby-activities.ts (liefert jetzt distanceById + radiusKm + expanded;
      nutzt domain/distance + domain/nearby)
  ~ src/lib/api.ts           (Activity.views_count; ProgressStats/ProgressResponse/
      LeaderboardEntry/LeaderboardResponse; api.viewActivity/progress/leaderboard)
  ~ src/app/(app)/index.tsx  (Glas-Kopf mit Level-Fortschritt -> /progress; Filterleiste;
      Trefferliste statt Regale bei aktivem Filter; rankActivities statt Ja/Nein;
      Umkreis-Hinweis; ehrliche Leertexte)
  ~ src/components/activity-card.tsx  (GlassSurface, distanceKm-Chip, layout 'card'|'row')
  ~ src/components/activity-shelf.tsx (distanceById + note unter der Ueberschrift)
  ~ src/components/activity-detail-modal.tsx (distanceKm im Ort, "N Leute haben reingeschaut",
      zaehlt den Aufruf beim Oeffnen)
  ~ src/app/_layout.tsx      (Stack.Screen progress)
  ~ server/src/routes/activities.js (views_count in transform + loadRelations; POST /:id/view)
  ~ server/src/db.js, server/schema.sql (activity_views)
  ~ tsconfig.json (noEmit + allowImportingTsExtensions – Node braucht .ts im Import)
  ~ package.json  (test / test:watch / test:server), server/package.json (test)

api:
  POST /api/activities/:id/view -> {views_count}  (pro Nutzer 1x, eigenes Event zaehlt nicht, 404)
  GET  /api/me/progress         -> {stats{hosted,joined,distinctInterests}, xp}
  GET  /api/leaderboard         -> {data[{rank,xp,stats,user}], me{...}}  (Top 50 + eigene Position)
  GET  /api/activities          -> zusaetzlich views_count je Eintrag

decisions:
  - XP-Gewichte liegen doppelt (server/src/gamification.js fuer Sortierung, src/domain/
    gamification.ts fuer Anzeige). Bewusst: Server braucht sie fuer ORDER BY, Client fuer
    sofortige Anzeige ohne Nachladen. Beide Seiten haben Tests, die die Formel festnageln;
    xpSqlExpression() wird im Test als JS ausgewertet und gegen xpFromStats() geprueft.
  - Unbekannte Entfernung filtert NICHT weg (lieber ein Treffer zu viel als ein unauffindbares
    Event, wenn der Ort nicht geocodiert werden konnte).
  - Views = 1 Zeile pro (activity,user) statt Zaehler-Spalte -> "von X Leuten gesehen" statt Klicks.
  - Glas: expo-glass-effect nur auf iOS 26 (isLiquidGlassAvailable()); sonst Nachbau aus
    Fuellung + Hairline + LinearGradient-Sheen, im Web zusaetzlich backdrop-filter.
    Kein neues Paket noetig (expo-glass-effect + expo-linear-gradient waren schon da).
  - Kein neuer Tab fuer die Suche: Filterleiste sitzt im Kopf der Startseite (weniger Navigation,
    NativeTabs nicht angefasst).
tests: 56 Domain-Tests (npm test) + 15 Server-Tests (npm run test:server, davon 9 echte
  HTTP-Integrationstests gegen die DB mit Aufraeumen) = 71 gruen.
  Alle test-first geschrieben (rot -> gruen belegt im Verlauf).
  tsc: nur 2 vorbestehende Fehler (animated-icon, collapsible); expo lint: 1 vorbestehender
  (activity-map.web.tsx); `npx expo export -p web` baut durch.
offen (Board): #8/#12/#14 Bezahlung (braucht Zahlungsanbieter + Store-Freigabe), #13 Push
  (Push-Dienst + Geraetetests), #10/#11 Business-Profil/Statistik, #15/#16 Freunde/Gruppen.
  #4 (Beitreten) und #7 (Karte) sind faktisch fertig, stehen aber noch im Backlog.
  Board-Status wurde NICHT veraendert (Entscheidung des Users).
offen (Technik): Zuverlaessigkeits-Quote/No-Show-Anzeige (staerkster Recherche-Befund),
  Empfehlungs-Gewichte nur heuristisch (keine Daten), Leaderboard ohne Monatsfenster (#18
  nennt "Monthly rankings"), Geocoding weiterhin pro Ort-String ohne Persistenz.

STEP 18 · app · branch main · Theme auf "helles cira" + Glas fuer alle Alt-Widgets
grund: User: "Thema zu einer helleren Version von cira.systems, alle alten Widgets im Glass
       Style, Funktionen an den Plan anpassen (OneDrive-Link)".
BLOCKER: Der Plan (Projekt.docx) ist fuer mich NICHT lesbar. Kette geprueft:
  1drv.ms -> 301 onedrive.live.com -> 302 my.microsoftpersonalcontent.com/doc2.aspx;
  WebFetch bekommt nur die JS-Huelle; api.onedrive.com/v1.0/shares/u!<b64>/root/content -> 401
  (Link ist nach SharePoint migriert); Browser-Pane rendert das Dokument in einem
  cross-origin iframe (nicht auslesbar); direkter Aufruf der inneren URL -> login.live.com;
  Screenshot scheitert ("Browser pane is not displayed"). => Punkt 3 des Auftrags offen,
  Inhalt muss der User liefern (Text hier einfuegen oder Datei ins Repo legen).

referenz-messung (Browser-Pane auf cira.systems, computed styles):
  bodyBg rgb(10,10,10) · Text rgb(245,245,245)/rgb(163,163,163)/rgb(115,115,115)
  Flaechen rgb(23,23,23) + oklab(...0.4) (also translucent) · Kanten rgb(38,38,38)
  Akzent oklch(0.673 0.182 276.935) = #818cf8 (indigo-400); weitere #6366f1/#4f46e5/#8b5cf6/
  #d946ef/#06b6d4 · Verlaeufe cyan->indigo und indigo->violet->fuchsia
  Schatten sind fast nur 1px-Ringe (0 0 0 1px rgba(255,255,255,0.1)) · Radien 6/8/16/pill
  Hintergrund hat ein 1px-Raster (linear-gradient 90deg + 0deg, rgba(255,255,255,0.05))
  Schrift "Instrument Sans"
=> helle Ableitung: Leinwand #fafafa, Raster rgba(23,23,23,0.045), Flaechen weiss-translucent,
   Kanten rgba(23,23,23,0.09), Text #171717/#737373, Akzent #4f46e5 (kraeftiger fuer Kontrast
   auf hell), Verlauf indigo->violet->fuchsia. Dunkelmodus ~= Originalwerte der Referenz.

deps+: @expo-google-fonts/instrument-sans ^0.4.2 (Schrift der Referenz)
files (Tokens & Grundlagen):
  ~ src/constants/theme.ts   (+Palette (alle Referenzwerte an einer Stelle), Colors neu,
      Brand-WERTE neu bei GLEICHEN Schluesseln (purple->#6366f1, pink->#d946ef, peach->#06b6d4,
      lavender->indigoSoft) => 15 Screens ziehen ohne Aenderung mit; BrandGradient jetzt
      3-stufig; +CoolGradient; Glass light/dark neu (Kontur statt Schatten);
      Radius knapper (chip 999 / field 10 / card 14 / panel 18); +FontFamily;
      +fontFamilyForWeight())
  ~ src/hooks/use-theme.ts   (useGlass bleibt, nutzt neue Werte)
  ~ src/components/themed-text.tsx (waehlt die Schriftdatei passend zum fontWeight –
      eingebundene Schriften leiten auf Android keine Staerken ab)
  ~ src/app/_layout.tsx      (4 Instrument-Sans-Schnitte laden)
  ~ src/global.css           (--font-display auf Instrument Sans; html/body/#root
      font-family + Hintergrund, sonst faellt Web-Text auf Times zurueck)
files (Hintergruende):
  ~ src/components/home-background.tsx  (Pastell-Blasen raus; jetzt #fafafa + 1px-SVG-Pattern-
      Raster + zwei sehr dezente Scheine (Indigo/Cyan); Dunkelmodus ~ Referenz)
  ~ src/components/goenn-background.tsx (gleiche Leinwand + Raster; Orbs auf Opacity 0.22
      gedimmt; 3 bunte Wellen -> 2 sehr weiche Indigo/Cyan-Wellen)
files (Alt-Widgets -> Glas):
  ~ ui/brand-button.tsx      (Verlauf oder Glas via variant; Schrift/Radius neu)
  ~ ui/brand-text-field.tsx  (GlassSurface statt weisser Karte, Fokus-Kontur in Akzentfarbe,
      Farben aus BrandSurfaces => funktioniert jetzt auch im Dunkelmodus)
  ~ history-card.tsx, interest-picker.tsx, activity-shelf.tsx (Leerzustand),
    activity-detail-modal.tsx (Sheet = tone="panel"), activity-card.tsx (schon Glas)
  ~ (app)/admin-panel.tsx (5 Flaechen: 2 Einstiege, listCard, kpiCard, chartCard),
    (app)/admin-evidence.tsx, admin-users.tsx (Karte + Aktions-Blatt),
    admin-moderation.tsx (Umschalter, Bericht-Karte, KPI), (app)/settings.tsx
    (HomeBackground als Leinwand + 3 Karten auf Glas)
  ~ auth-illustration.tsx (Pastell-Badges -> Indigo/Violett/Cyan-Abstufungen)
  ~ ui/icons.tsx, login-panel.tsx, create-activity.tsx, (auth)/register.tsx, admin.tsx
      (alte Farbliterale #9b6dff/#7c3aed/#c4b5fd/#f5f3ff/rgba(155,109,255,..) ersetzt)
  ~ login-panel/(auth)-Screens/create-activity/admin.tsx: fontFamily je Stil-Block ergaenzt
      (Skript nach fontWeight; Pacifico im Logo unangetastet)
verifikation (echt, im Browser gegen den exportierten Web-Build gemessen):
  - Textelemente: 6x Regular, 3x Medium, 5x SemiBold, 6x Bold, 1x Pacifico – KEIN Times/
    System-Fallback mehr (vorher 13x -apple-system + 4x Times).
  - htmlFont=InstrumentSans_400Regular; Leinwand rgb(250,250,250); Chip rgba(99,102,241,0.18);
    Glasflaeche rgba(255,255,255,0.8); Raster-Pattern vorhanden; backdrop-filter auf 2 Elementen;
    Illustration jetzt indigo-200/violet-200/cyan-200/indigo-300; keine warmen Alt-Toene mehr.
  - Dunkelmodus greift (Pane stand auf dark): rgba(23,23,23,0.84) + Kante rgba(255,255,255,0.1).
  - tsc: nur 2 vorbestehende Fehler; expo lint: 1 vorbestehender; npm test 56/56;
    npm run test:server 15/15; expo export -p web baut durch.
decisions:
  - Brand-Schluessel bewusst NICHT umbenannt: ein Werte-Tausch rethemet 15 Dateien ohne Risiko.
    Nachteil ist der irrefuehrende Name (`purple` ist jetzt Indigo) – im Code kommentiert.
  - Radien absichtlich knapper (10/14/18 statt 16/20/28): so sieht die Referenz aus. Die
    Freundlichkeit kommt aus Verlauf und Lichtsaum, nicht aus grossen Rundungen.
  - Ringe statt Schlagschatten (Referenz nutzt fast nur 1px-Konturen).
  - fontFamily wird aus fontWeight abgeleitet statt fontWeight zu ersetzen: der Code bleibt
    lesbar und Web nutzt weiterhin echte Staerken.
offen: Punkt 3 (Funktionen an den Plan anpassen) blockiert, siehe BLOCKER oben.
  Ausserdem weiter offen: app-tabs nutzt fuer die System-Tableiste noch colors.backgroundElement
  (kein Glas moeglich, das ist die native Leiste).

STEP 19 · backend+app · branch main · Kontotyp in den Einstellungen umschaltbar (Admin)
grund: User-Story "Als Admin moechte ich mein Konto in den Einstellungen von Persoenlich auf
       Business wechseln koennen". Bisher war account_type nur bei der Registrierung setzbar
       und in den Einstellungen ein reiner Anzeigewert (LinkRow ohne Aktion).
files:
  ~ server/src/routes/auth.js  (PATCH /api/user nimmt account_type an: 403 fuer Nicht-Admins,
      422 {errors.account_type} bei unbekanntem Wert, sonst UPDATE wie die anderen Felder)
  ~ src/lib/api.ts             (UpdateProfileInput.account_type?: AccountType)
  ~ src/app/(app)/settings.tsx (+ACCOUNT_TYPES; Konto-Gruppe: fuer is_admin ein Zweifach-
      Umschalter (Persoenlich|Business) mit Spinner/Fehlerzeile statt der Anzeige-Zeile;
      Nicht-Admins sehen unveraendert die LinkRow; onSelectAccountType -> updateProfile)
  ~ server/test/api.test.js    (+patchUser/makeAdmin-Helfer, 4 Tests)
api:
  PATCH /api/user {account_type:'personal'|'business'} -> 200 {user,profile_complete}
      403 {message} ohne Admin-Rechte · 422 {errors:{account_type}} bei unbekanntem Wert
decisions:
  - Gate am FELD statt am Endpunkt (kein requireAdmin auf PATCH /user): Name/E-Mail/
    Benutzername/Interessen muessen fuer alle aenderbar bleiben.
  - Nur Admins duerfen umstellen (so die User-Story). Fuer alle oeffnen = die eine Zeile
    `if (!req.user.is_admin) throw ...` streichen + `user?.is_admin` im Screen entfernen.
  - Kein Bestaetigungsdialog: zwei Optionen, jederzeit zurueckschaltbar, Zustand steht sichtbar
    in der Auswahl. Fehler landet als Zeile unter der Auswahl (wie bei den Interessen).
  - account_type-Spalte existierte bereits (schema.sql) -> keine Migration noetig.
  - Der Umschalter vergleicht gegen user.account_type (nullable), nicht gegen die Anzeige:
    Google-Konten starten ohne Kontotyp (google.js INSERT setzt ihn nicht), dort muss auch
    'Persoenlich' noch speicherbar sein statt als "schon ausgewaehlt" zu gelten.
tests (echt, gegen laufende MySQL): npm run test:server 19/19 gruen (4 neu: Admin schaltet hin
  und zurueck; Nicht-Admin -> 403 und Wert bleibt; 'enterprise' -> 422; name-Update bleibt fuer
  alle erlaubt). tsc: nur die 2 vorbestehenden Fehler (animated-icon, collapsible);
  expo lint: nur der 1 vorbestehende (activity-map.web.tsx).
NICHT verifiziert: kein Browser-/Geraete-Test der neuen Zeile. Der laufende Backend-Prozess auf
  :8000 wurde als `node src/index.js` (ohne --watch) von einer anderen Sitzung gestartet und
  haelt den alten Code -> Umschalten in der laufenden App wuerde stumm nichts tun, bis das
  Backend neu gestartet ist (npm run server). Fremden Prozess bewusst nicht beendet.

STEP 20 · backend+app · branch main · Vier Kontostufen (Standard/Creator/Business/Business Plus)
grund: User-Story "Admin in den Kontoeinstellungen: welches Konto ich auswaehlen kann - Standard,
       Creator, Business, Business Plus. Creator darf Events erstellen (Standard nicht), Business
       bekommt Extra-Tabs (Umsatz sehen, Reichweite erweitern). Angeboten wird die Stufe erst in
       der App, in einem kleinen Feld oben links, auf dem 'Upgrade' steht."
       Vorher gab es zwei Werte ('personal'/'business') ohne jede Wirkung: kein Recht hing daran.
files:
  + src/domain/account.ts (+ account.test.ts, 13 Tests)
      Stufen ALS DATEN: label/tagline/perks + capabilities {canCreateActivities, hasBusinessArea,
      boostSlots, insightMonths}. normalizeAccountType ('personal'/NULL/Unsinn -> 'standard'),
      tierFor/rankOf/nextTier/accountLabel/capabilitiesFor/accountAbilities (Admin-Ausnahme).
  + server/src/accounts.js (+ server/test/accounts.test.js, 9 Tests)
      Spiegel derselben Regeln fuer den Server (ACCOUNT_TYPES, SELF_SERVICE_ACCOUNT_TYPES,
      BOOST_DAYS=7, abilitiesFor). Die App versteckt, der Server verbietet.
  + server/src/routes/business.js   (GET /insights, POST/DELETE /activities/:id/boost)
  + src/app/upgrade.tsx             (Stufen-Angebot: Admin schaltet um, alle anderen fragen an)
  + src/app/(app)/business.tsx      (fuenfter Tab: Umsatz | Reichweite, Hervorheben je Event)
  + src/components/upgrade-chip.tsx (das Feld oben links; weg auf der hoechsten Stufe)
  ~ server/src/routes/auth.js       (register: nur standard|creator [+'personal' als Altwert];
      PATCH: alle vier, weiter Admin-only am FELD; Werte werden normalisiert gespeichert)
  ~ server/src/routes/activities.js (POST: 403 ohne canCreateActivities; boosted_until im transform)
  ~ server/src/db.js                (ensureSchema: ALTER activities +boosted_until,
      UPDATE users SET account_type='standard' WHERE account_type='personal')
  ~ server/schema.sql, server/src/seed.js (Admin auf 'business_plus', COALESCE statt Ueberschreiben)
  ~ server/src/app.js               (+ /api/business)
  ~ server/test/api.test.js         (registerUser(prefix, accountType='creator'), tryRegister,
      tryCreateActivity, setAccountType, boost-Helfer; 17 neue Tests)
  ~ src/lib/api.ts                  (AccountType kommt aus der Domain; Activity.boosted_until;
      BusinessInsights/BusinessEvent/BoostResult; businessInsights/boostActivity/unboostActivity)
  ~ src/domain/recommendations.ts (+ Tests) (WEIGHTS.boosted=25, isBoosted() exportiert)
  ~ src/app/(app)/settings.tsx      (Kontotyp-Block: vier Stufen untereinander (Admin) mit den
      Vorzuegen an der aktiven; ohne Admin-Rechte Anzeige + Verweis aufs Upgrade-Feld)
  ~ src/app/(app)/index.tsx         (UpgradeChip links neben der Wortmarke; ＋ nur mit Recht;
      Leertexte je Recht) · (app)/my-activities.tsx (Leerzustand fuehrt zum Upgrade)
  ~ src/app/create-activity.tsx     (gesperrte Hinweis-Seite, NACH allen Hooks)
  ~ src/app/(auth)/register.tsx     (nur Standard|Creator + Hinweis auf das Upgrade)
  ~ src/app/_layout.tsx             (Stack.Screen "upgrade")
  ~ src/components/app-tabs.tsx     (5. Trigger "business" mit hidden={!hasBusinessArea}) ·
      app-tabs.web.tsx (bedingter TabTrigger)
  ~ src/components/account-widget.tsx, src/app/admin-users.tsx (accountLabel statt eigener Maps)
  ~ .claude/launch.json             (dritter Web-Port 8098 - 8082/8095 belegte eine andere Sitzung)
api:
  POST /api/register  {account_type:'standard'|'creator'|'personal'} -> 201
      422 {errors.account_type} bei 'business'/'business_plus' ("nur per Upgrade") und bei Unsinn
  PATCH /api/user     {account_type: eine der vier (+'personal')} -> 200, Wert normalisiert
      403 ohne Admin-Rechte · 422 bei unbekanntem Wert
  POST /api/activities -> 403 {message ~ /Creator/} ohne canCreateActivities
  GET  /api/activities -> Activity zusaetzlich mit boosted_until (ISO|null)
  GET  /api/business/insights -> {account_type, months, revenue{available,currency,gross_cents,
      reason}, bookings{total,series[]}, reach{events,views,visitors,series[]},
      boost{slots,used,days}, events[{id,title,starts_at,boosted_until,views,bookings}]}
      403 unter Business · 401 ohne Anmeldung
  POST/DELETE /api/business/activities/:id/boost -> {id, boosted_until}
      422 wenn alle Plaetze der Stufe belegt · 403 fremdes Event · 404 unbekanntes
decisions:
  - Rechte als DATEN an einer Stelle (src/domain/account.ts), gespiegelt in server/src/accounts.js.
    Grund: Upgrade-Liste und Riegel im Server duerfen nicht auseinanderlaufen; beide Testdateien
    halten die Rechte je Stufe fest.
  - EIN Business-Tab mit Umschalter statt zwei Tabs (Umsatz/Reichweite). Androids untere Leiste
    fasst hoechstens fuenf Ziele, ab sechs faltet sie in ein "More"-Menue - genau die Falle, die in
    app-tabs.tsx schon dokumentiert stand. Vier Ziele haben alle Nutzer, bleibt einer uebrig.
  - `hidden` am Trigger statt bedingtes Rendern: Die Route bleibt im Baum (kein Neuaufbau der
    Navigation), ist aber nicht erreichbar - so steht es in der expo-router-Doku.
  - Upgrade als eigener SCREEN, nicht als Blatt: Vier Stufen mit Vorzuegen brauchen den Platz, und
    das Blatt-Geruest aus account-widget.tsx haette dafuer zerlegt werden muessen (Risiko ohne Not).
  - GENAU EIN Weg zum Upgrade (das Feld oben links). Die Einstellungen sind der Admin-Weg; ohne
    Admin-Rechte steht dort nur die Stufe + Verweis. Sonst gaebe es zwei Wege, die auseinanderlaufen.
  - Registrierung vergibt nur Standard/Creator. Business im Selbstbedienungsverfahren machte die
    Sperre wertlos; der Server nimmt es dort auch nicht an.
  - 'personal' -> 'standard' einmalig in ensureSchema UND beim Lesen normalisiert (installierte
    App-Builds schicken den Wert weiter). NULL bleibt bewusst NULL: profileComplete prueft darauf,
    sonst gelten Google-Konten ohne Kontotyp ploetzlich als vollstaendig.
  - Admin-Ausnahme NUR beim Erstellen. Erst hatte ein Admin auch die Boost-Plaetze der hoechsten
    Stufe - im Browser stand dann "0/5 belegt" neben dem Versprechen "1 Event gleichzeitig".
    Jetzt folgt alles ausser dem Anlegen der eingestellten Stufe; so sieht ein Admin genau das,
    was das gepruefte Konto sieht.
  - Umsatz wird NICHT erfunden: kein Preis am Event, keine Zahlungen in der DB. Der Server liefert
    revenue.available=false + Grund, die App zeigt 0,00 € mit genau diesem Satz. Echt sind die
    Buchungen (Beitritte ohne den eigenen Platz) - daraus wird spaeter der Umsatz.
  - "Reichweite erweitern" tut wirklich etwas: boosted_until an der activity + WEIGHTS.boosted=25
    in den Empfehlungen. Bewusst kleiner als ein Interessen-Treffer (40): Reichweite kaufen heisst
    "weiter vorne", nicht "vor allem anderen". Abgelaufene Boosts zaehlen nicht mehr (die Zeit
    entscheidet, es braucht keinen Aufraeum-Job).
  - Balken aus GlassProgressBar statt eigener Diagramm-Komponente; Euro-Format von Hand (die
    Intl-Daten sind auf Android nicht ueberall an Bord, "1234.5" waere im Umsatz besonders schlecht).
tests: npm test 113/113 (13 neu account, 5 neu recommendations) · npm run test:server 45/45
  (17 neu: Registrier-Regeln, Creator-Sperre inkl. Admin-Ausnahme, insights-Gate/Zahlen/Fenster je
  Stufe, Boost-Plaetze/Verlaengern/fremdes Event/404). tsc: keine neuen Fehler (vorbestehend:
  animated-icon, ui/collapsible, dazu 6x progress.tsx aus einer parallel laufenden Sitzung).
  expo lint: nur der vorbestehende Fehler in activity-map.web.tsx.
verifikation (echt, Web-Build auf :8098 gegen das laufende Backend :8000; zwei Wegwerf-Konten per
  API angelegt, Token in localStorage gesetzt, danach beide Konten samt Event wieder geloescht):
  - Standard-Konto: Feld "✨ Upgrade" oben links neben der Wortmarke, KEIN ＋-Knopf, KEIN
    Business-Tab (Home/Map/Aktivitaeten/Einstellungen), /create-activity zeigt die gesperrte Seite.
  - /upgrade ohne Admin-Rechte: "Deine Stufe: Standard", AKTUELL-Plakette, drei Mal "… anfragen"
    und der ehrliche Satz, dass von Hand freigeschaltet wird.
  - /upgrade als Admin: "Zurueck auf Standard" / "Auf Business wechseln" / "Auf Business Plus wechseln".
  - Business-Konto: fuenfter Tab da; Umsatz "0,00 €" + Grund vom Server, Buchungen 1 / Events 1 /
    Besucher:innen 1, "Buchungen je Monat" Mai 0 · Jun 0 · Jul 1 (3-Monats-Fenster ohne Luecken);
    Reichweite: 1 Aufruf von 1 Person, "0/1 belegt" -> nach dem Tippen "★ hervorgehoben" und
    "1/1 belegt", boosted_until in der DB = 2026-08-03 (7 Tage).
  - Einstellungen als Admin: vier Stufen untereinander, Vorzuege an der aktiven; der Wechsel auf
    Creator liess den Business-Tab sofort verschwinden.
NICHT verifiziert: kein Test am Geraet - die native Tab-Leiste mit fuenf Zielen und das SF-Symbol
  "chart.line.uptrend.xyaxis" sind nur im Web geprueft (dort zeichnet app-tabs.web.tsx). Kein
  Bildschirmfoto: die Browser-Pane war ausgeblendet, dann liefert sie keine Bilder. Der mailto-Weg
  fuer Upgrade-Anfragen wurde nicht ausgeloest. Der Umsatz hat weiterhin keine Datenquelle.
achtung: In diesem Arbeitsbaum arbeitete waehrenddessen eine zweite Sitzung (index.tsx, progress.tsx
  und das CORS in app.js kamen unter der Hand dazu). Alle Aenderungen von hier sind drin, aber vor
  dem Commit einmal `git diff` querlesen.

STEP 21 · backend+app · branch main · Oeffentliche Profilseite (Beitraege + Social-Links) ab Creator
grund: User-Wunsch: Klick oben rechts aufs Konto oeffnet die eigene Profilseite – mit Kontoart,
       eigenen Beitraegen (Community Post) und Social-Media-Links, sichtbar auch fuer andere.
       Nur mit Creator oder Business Plus. Rueckfrage geklaert (AskUserQuestion):
       Beitraege = NEUE Post-Entitaet (nicht die Events), Stufe vergibt der Admin (bestand
       bereits aus STEP 20), und ohne Stufe gilt: keine Events erstellen (bestand bereits)
       UND kein oeffentliches Profil (neu).
entscheidung zur Stufe: Das Recht haengt an hasPublicProfile und gilt ab Creator – also auch
       fuer Business, nicht nur fuer Creator/Business Plus. Grund: Die Leiter ist kumulativ
       (Test "jede Stufe kann mindestens so viel wie die darunter"); Business zwischen Creator
       und Business Plus das Profil zu nehmen, waere die einzige Luecke in der Leiter.
       KEINE Admin-Ausnahme (anders als canCreateActivities): Ein Profil ist ein eigener
       Auftritt, kein Werkzeug der Moderation – sonst koennte ein Admin nie sehen, was ein
       Standard-Konto sieht. Gleiche Begruendung wie bei hasBusinessArea.

files (Regeln, beide Seiten):
  ~ src/domain/account.ts        (+AccountCapabilities.hasPublicProfile; standard false, ab
      creator true; Creator-perks +"Oeffentliches Profil mit Beitraegen und Social-Links",
      weil die Upgrade-Liste aus derselben Quelle kommt)
  ~ server/src/accounts.js       (gleiche Werte in CAPABILITIES)
  ~ src/domain/account.test.ts, server/test/accounts.test.js (Recht je Stufe, Monotonie-Test
      erweitert, keine Admin-Ausnahme)
files (neu, Domaene):
  + src/domain/social-links.ts|.test.ts  (SOCIAL_PLATFORMS 8 Stueck mit Label/Icon/baseUrl/
      Beispiel, MAX_SOCIAL_LINKS = Laenge der Liste, normalizeSocialInput (Handle / nackte
      Domain / volle Adresse -> https-URL), displaySocialLink ("@name" bzw. Domain), sortLinks.
      BEWUSST ohne new URL (Hermes) und ohne Abhaengigkeit -> laeuft in node --test wie in der
      App. Die Schema-Pruefung ist der Kern: diese Links werden angetippt, javascript: oder
      data: duerfen nie durchkommen.)
  + server/src/social.js + server/test/social.test.js (parseLinkList: PUT-Semantik, bekannte
      Plattform, http(s), Laenge, keine Doppel, leere Eintraege fallen raus. Der Server baut
      BEWUSST keine URLs aus Handles -> kein zweiter Satz Praefixe, der auseinanderlaufen kann.)
files (DB):
  ~ server/schema.sql, server/src/db.js (ensureSchema)
      + posts (user_id, body VARCHAR(1000), image_path, created_at; FK CASCADE)
      + user_links (user_id, platform, url; UNIQUE (user_id, platform); FK CASCADE)
files (backend):
  + server/src/routes/profile.js  (GET /users/:username · PUT /me/links · POST /posts ·
      DELETE /posts/:id; requireProfile = abilitiesFor().hasPublicProfile)
  ~ server/src/app.js             (profileRouter unter /api; CORS-Methoden +PUT – ohne das
      scheitert PUT /me/links im Web-Build schon an der Vorabfrage)
  ~ server/src/moderation.js      (moderateContent({context}) neu, moderateActivity ist jetzt
      ein duenner Aufruf davon; buildPrompt kennt 'post' (kein Titel, keine Interessen);
      saveReport schreibt den context statt hart 'activity'; fieldErrorsFor(check, map) fuer
      die Felder eines Beitrags; SYSTEM_PROMPT nennt Beitraege mit)
  ~ server/src/routes/activities.js (host.account_type in transform + loadRelations -> die App
      weiss, ob sich der Host-Name verlinken laesst)
files (app):
  + src/app/profile/[username].tsx (eine Seite fuer beide Blickwinkel; is_me schaltet
      Verfassen/Loeschen/Link-Editor zusaetzlich frei. Zahnrad oeffnet das AccountSheet, weil
      der Konto-Knopf jetzt hierher fuehrt. Eigenes Konto ohne Stufe -> Upgrade-Hinweis statt
      404. Datum ohne Intl, wie in activity-detail-modal.tsx.)
  ~ src/app/_layout.tsx           (Stack.Screen "profile/[username]" im geschuetzten Bereich)
  ~ src/app/(app)/index.tsx       (Konto-Knopf: ab Creator -> Profil, sonst weiter das Blatt)
  ~ src/components/account-widget.tsx (Eintrag "Mein Profil", nur mit Stufe UND Username)
  ~ src/components/activity-detail-modal.tsx (Host-Name als Link aufs Profil, wenn dessen Stufe
      eins hat; sonst unveraenderter Text)
  ~ src/lib/api.ts                (ProfilePost/ProfileLink/PublicProfile; api.profile/
      createPost/deletePost/saveLinks; RequestOptions +PUT; generischer upload<T>-Helfer;
      ActivityHost.account_type)
  ~ .claude/launch.json           (+expo-web-profile auf 8099, eigener Port neben der parallel
      laufenden Sitzung)
api:
  GET    /api/users/:username -> {user{...,account_type,is_admin,created_at}, links[], posts[],
         stats{hosted,joined,posts}, is_me} · 404 wenn Name unbekannt ODER Stufe ohne Profil
         (bewusst dieselbe Antwort: ein 403 wuerde verraten, dass es das Konto gibt)
  PUT    /api/me/links {links:[{platform,url}]} -> {links[]} · 422 · 403 ohne Stufe
  POST   /api/posts (multipart: body + optional image) -> 201 {data} · 422 · 403 (Stufe oder
         Auto-Sperre mit {ban, moderation} wie bei den Events)
  DELETE /api/posts/:id -> {message} · 403 fremd · 404
decisions:
  - Links werden komplett ersetzt (PUT) und in einer TRANSAKTION geschrieben. Ohne die stuende
    nach einem abgelehnten zweiten Eintrag ein leeres Profil da (das DELETE war schon gelaufen)
    – dafuer gibt es einen eigenen Test.
  - 404 statt 403 beim fremden Profil (siehe oben).
  - Beitraege gehen durch dieselbe KI-Verifizierung wie Events (context 'post'); im Admin-Panel
    sind sie an der Spalte context unterscheidbar.
  - Bild am Beitrag mit eigener multer-Fehlerbehandlung: der allgemeine Handler in app.js
    spricht von einem "Banner-Bild", das es bei einem Beitrag nicht gibt.
  - Beim Loeschen eines Beitrags geht das Bild sofort mit (anders als beim Event-Banner haengt
    kein Verlaufs-Eintrag daran).
tests: npm test 134/134 (20 neu social-links, 1 neu account) · npm run test:server 79/79
  (22 neu: Profil sichtbar/eigen/gesperrt, Admin auf Standard hat auch keins, 404-Faelle, 401,
  Posten inkl. Standard-Sperre/leer/zu lang/Reihenfolge, Loeschen eigen/fremd/Admin/404,
  Links setzen-ersetzen-leeren/Schema/unbekannt/403/Rollback, Profil-Zahlen, host.account_type).
  Alle test-first (rot -> gruen belegt). tsc: nur die 2 vorbestehenden Fehler (animated-icon,
  ui/collapsible). expo lint: nur der vorbestehende (activity-map.web.tsx).
verifikation (echt, eigener Web-Build auf :8099 gegen das laufende Backend :8000; zwei
  Wegwerf-Konten per API, danach samt Beitraegen und Links geloescht – CASCADE mitgeprueft):
  - Creator: Konto-Knopf oeffnet /profile/<name>; Kopf mit CREATOR-Plakette, "Dabei seit Juli
    2026", 2 Beitraege / 0 / 0; Links als Chips (Instagram @goenn4fun, TikTok @goenn4fun,
    eigene Seite goenn4fun.de).
  - Beitrag ueber die Oberflaeche verfasst: Umlaute, Gedankenstrich und Emoji korrekt, Zaehler
    2->3, neuer Beitrag sofort oben, Feld danach leer. (Ein per curl aus der Git-Bash
    eingespielter Text hatte kaputte Umlaute – das war die Konsolen-Kodierung, nicht die App.)
  - Loeschen: 3->2, Zaehler geht mit. Link-Editor: vorbelegt mit der KURZform, TikTok geleert
    und YouTube ergaenzt -> gespeichert und in Plattform-Reihenfolge zurueck.
  - Zahnrad auf dem Profil oeffnet das Konto-Blatt inkl. neuem Eintrag "Mein Profil".
  - Standard-Konto: Konto-Knopf oeffnet weiter das Blatt (ohne "Mein Profil" darin), kein
    +-Knopf; /profile/<eigener name> zeigt "Ein Profil gibt es ab Creator" + Upgrade-Knopf;
    ein fremdes Standard-Profil zeigt "Dieses Profil gibt es nicht".
  - 0 Konsolenfehler; kein horizontales Scrollen; 8 Flaechen mit backdrop-filter (Glas greift);
    Dunkelmodus mit hellem Text auf getoenter Flaeche.
  - Nebenbefund und behoben: "Loeschen" und "Bearbeiten" waren Pressables ohne
    accessibilityRole/Label – jetzt gesetzt (Screenreader wie Testbarkeit).
NICHT verifiziert: kein Test am Geraet. Kein Bild an einem Beitrag durchgespielt (der Bildwaehler
  braucht Galerie/Kamera, im Web-Build nicht sinnvoll pruefbar); der Server-Pfad dafuer ist nur
  durch die Formularpruefung und die vorhandene Banner-Logik abgedeckt. Die KI-Verifizierung von
  Beitraegen lief NICHT gegen ein echtes Modell (kein ANTHROPIC_API_KEY in der Dev-Umgebung) –
  geprueft ist der Weg, nicht das Urteil. Kein Bildschirmfoto (Browser-Pane ausgeblendet).
offen (eigene Tickets): Beitraege lassen sich nicht bearbeiten, nur loeschen. Keine Reaktionen
  und keine Kommentare. Bilder geloeschter Konten bleiben auf der Platte liegen (dieselbe Luecke
  wie bei den Bannern). Die Profil-Adresse haengt am Benutzernamen: Google-Konten ohne Username
  koennten auch mit Stufe kein Profil oeffnen (die App blendet den Weg dann aus). Keine
  Paginierung – das Profil liefert die letzten 50 Beitraege.
achtung: In diesem Arbeitsbaum lief waehrenddessen eine zweite Sitzung (STEP 20 entstand parallel;
  accounts.js, business.js, upgrade.tsx kamen mitten in der Arbeit dazu). Diese Aenderungen bauen
  darauf auf, statt daneben ein zweites Stufen-System zu stellen.

STEP 22 · app · branch main · Alle Textfelder neu gebaut + echte Tastatur-Freistellung
grund: User (Handy): "Die Tastatur funktioniert immernoch nicht" – nach mehreren Anlaeufen
  (presentation:'modal' raus, KAV-behavior, keyboardDismissMode). Ansage: jedes Textfeld neu
  schreiben und nicht auf dem alten aufbauen.
ursache (belegt, nicht geraten): Die Annahme aller Vor-Fixes war "Android schiebt das Feld
  selbst frei (softwareKeyboardLayoutMode 'pan'), deshalb braucht die KeyboardAvoidingView
  auf Android kein `behavior`". Beide Haelften stimmen nicht:
  1. KeyboardAvoidingView.js:286 (node_modules, RN 0.81) – ohne `behavior` greift der
     `default:`-Zweig und rendert eine ganz normale `View`. Die Komponente tut NICHTS.
  2. 'pan' (= android:windowSoftInputMode adjustPan) greift unter dem ab SDK 54 erzwungenen
     edge-to-edge nicht mehr zuverlaessig; Expos eigene app.json-Doku sagt zu translucent
     status bar: "you will have to use KeyboardAvoidingView to manage the keyboard layout".
  => Auf Android gab es damit GAR KEINE Freistellung: die Tastatur legte sich einfach ueber
     das Feld. Mit `behavior="padding"` war es vorher anders defekt (die KAV ruft bei jedem
     Tastatur-Ereignis LayoutAnimation.configureNext und aendert die Container-Hoehe -> auf
     Fabric werden Views neu aufgebaut, Fokus weg, Tastatur klappt zu).
files:
  + src/components/ui/text-field.tsx        (TextField, komplett neu; memo + forwardRef;
     Fokus aendert NUR Farbe, keine Geometrie/kein Schatten; `...rest` zuerst, dann
     onFocus/onBlur die die uebergebenen mitrufen (vorher ueberschrieb der Spread sie still);
     multiline; `fieldStyle` fuer kompakte Zeilen; meldet sich beim Fokus via ensureVisible)
  + src/components/ui/keyboard-form.tsx     (KeyboardForm: ScrollView, die die Tastaturhoehe
     als Abstandshalter ans ENDE des Inhalts haengt – keine LayoutAnimation, keine
     Container-Hoehenaenderung, also keine Rueckkopplung. Scrollt das fokussierte Feld frei
     ueber endCoordinates.screenY + measureInWindow)
  + src/components/ui/form-scroll-context.ts (ensureVisible-Kanal Feld -> Formular)
  + src/hooks/use-keyboard-inset.ts         (nur Tastaturhoehe – fuer Blaetter im Modal ohne ScrollView)
  - src/components/ui/brand-text-field.tsx  (geloescht, keine Referenzen mehr)
  ~ 10 Aufrufstellen auf TextField/KeyboardForm umgestellt: login-panel, (auth)/register,
     (auth)/forgot-password, create-activity, admin, admin-users (Modal-Blatt -> useKeyboardInset),
     (app)/settings (roher TextInput -> TextField, kompakt via fieldStyle/minHeight:0),
     profile/[username] (2 rohe TextInputs -> linkField/composerField), location-picker.web
  ~ src/components/ui/glass.tsx             (GlassSearchField: memo – das Feld sitzt ueber der
     Ergebnisliste, jeder Tastendruck rendert den Eltern-Screen neu; eigene Vorgaben jetzt vor
     `...rest`, `style` danach)
  ~ src/components/goenn-background.tsx     (kein useWindowDimensions mehr: Flaechen auf 100%,
     Orb/Wellen-Masse einmal beim Einhaengen. Vorher wurde auf den Anmelde-Screens bei JEDEM
     Tastendruck das komplette SVG + 3 animierte Scheine + 2 Wellen neu aufgebaut)
  ~ src/app/(auth)/index.tsx                (Schiebe-Hoehe einmal beim Einhaengen statt
     useWindowDimensions – sonst wurden beide interpolate-Knoten bei jedem Tastendruck neu
     gebaut und dem Animated.View untergeschoben)
decisions:
  - app.json NICHT angefasst: 'pan' bleibt. Wichtig, weil 'pan' die Fenstergroesse NICHT
    aendert und damit keine Messschleife mit dem eigenen paddingBottom bilden kann; 'resize'
    koennte das. Der Fix ist so unabhaengig davon, ob edge-to-edge greift oder nicht.
  - react-native-keyboard-controller (Expos Empfehlung fuer groessere Formulare) bewusst NICHT
    genommen: braucht einen Dev-Build, der Geraetetest laeuft ueber Expo Go.
tests: tsc – 0 Fehler in allen angefassten Dateien (die 20 restlichen Fehler sind der parallel
  laufende Icon/SocialIcon-Umbau, nicht von hier). eslint – 0 Fehler, 0 eigene Warnungen.
  Web (Port 8097, 0 Konsolenfehler): register 4 Felder, forgot-password 1, login 2 (inkl.
  Augen-Umschalter), create-activity Titel/Beschreibung(TEXTAREA)/Ort mit Karten-Pin/Strasse,
  settings Inline-Zeile (minHeight 0px, 38px hoch, 1px Rand = kompakt greift), profil-Composer.
  Zeichenweise getippt und nach JEDEM Zeichen geprueft: DOM-Knoten identisch (kein Remount),
  kein Zeichen verschluckt. Android-Payload gegen die RN-Quelle geprueft (ReactRootView.java:1047):
  endCoordinates.screenY + .height existieren – KeyboardForm rechnet auf echten Werten.
NICHT verifiziert: Die Soft-Tastatur selbst ist auf Web nicht pruefbar (react-native-web hat
  keine). Ob die Felder am Geraet aufgehen und offen bleiben, muss der User in Expo Go sagen.
  Kein Bildschirmfoto (Browser-Pane ausgeblendet). Die Social-Link-Felder im Profil wurden nicht
  angetippt (Fast Refresh der Parallel-Sitzung setzte den Aufklapp-Zustand jedes Mal zurueck) –
  sie nutzen dasselbe Muster wie die geprueften Felder.
achtung: Parallel lief eine zweite Sitzung im selben Arbeitsbaum (Icon/SocialIcon-Umbau in
  settings.tsx, account-widget.tsx, profile/[username].tsx). Deren Aenderungen wurden stehen
  gelassen.

STEP 23 · backend+app · branch main · Praemien statt Serie, Storys, Freunde-Tab, Maskottchen ueberall
grund: User-Wunschliste in einem Zug: Suche/Filter unter „Worauf hast du Lust?" verstecken,
  Settings-Bereiche ausklappbar, Streak raus und Praemien (Coupons gegen Punkte, 10 Punkte je
  erstellter Aktivitaet) rein, Storys von Creator-/Business-Konten unter der Hero-Karte, Tab
  „Freunde" mit Gruppen, Nutzersuche die auf Profile fuehrt, Upgrade nur auf die naechste Stufe,
  Maskottchen mit Tab-Stimmung + Dauerhuepfen + „Oh oh"-Fehlerzustand, ＋-Knopf pulsierend.
entscheidungen (das Nicht-Offensichtliche zuerst):
  - Punkte sind KEINE XP. XP (gamification.js) sind eine Ableitung aus dem Stand und sinken beim
    Loeschen eines Events wieder – bei einem Level in Ordnung, bei einer WAEHRUNG nicht: Ein
    eingeloester Coupon laesst sich nicht zurueckgeben, der Stand darf also nicht von selbst
    fallen. Punkte liegen deshalb als Buchungen in `reward_points`; `activity_id` faellt beim
    Loeschen per ON DELETE SET NULL auf NULL, die Buchung bleibt. Guthaben = Summe Buchungen −
    Summe Einloesungen. Einloesen laeuft in einer Transaktion mit `FOR UPDATE` (zwei parallele
    Aufrufe wuerden sonst dasselbe Guthaben sehen und zusammen mehr ausgeben als da ist).
  - Idempotenz + Nachtrag: UNIQUE (user_id, reason, activity_id) macht die Buchung doppel-sicher;
    `backfillActivityPoints` traegt Bestands-Events beim ersten Blick auf die Praemien nach.
    Ohne das stuende jedes Bestandskonto bei 0, obwohl es Events erstellt hat.
  - Business ist KEIN Tab mehr. Androids untere Leiste fasst 5 Ziele; mit „Freunde" sind die 5
    von dem belegt, was ALLE Konten haben. Ein Bereich fuer eine Stufe kann darauf keinen
    Anspruch haben -> eigene Stack-Route, erreichbar ueber das Konto-Blatt (derselbe Weg, den
    der Admin-Bereich aus demselben Grund schon geht). Damit hat die Leiste auch keine
    bedingten Eintraege mehr: Die Navigation aendert sich nicht mehr unter der Hand, wenn sich
    eine Kontostufe aendert.
  - GET /api/users/:username gibt es jetzt fuer JEDES Konto mit Benutzernamen (vorher 404 unter
    Creator). Zwang der Nutzersuche: Man findet jemanden, tippt drauf – und landete bei „gibt es
    nicht". Was die Stufe entscheidet, ist der INHALT (`shows_posts`): Beitraege und
    Social-Links ab Creator, darunter eine Visitenkarte mit Zahlen. Schreiben bleibt gesperrt
    (`requireProfile`).
  - Tabelle heisst `friend_groups`, nicht `groups`: GROUPS ist in MySQL 8 reserviert
    (Fenster-Funktionen), jede Abfrage braeuchte sonst Backticks.
  - Freundschaft = EINE Zeile (requester/addressee/status), keine Spiegelzeile. Kostet etwas
    mehr SQL beim Lesen, kann dafuer nie halb bestehen. „Anfragen" und „Annehmen" sind EIN
    Endpunkt: Liegt eine Anfrage in die andere Richtung vor, ist die Antwort darauf ein Ja und
    keine zweite, gekreuzte Anfrage. In Gruppen kommen nur bestaetigte Freunde – sonst waere
    „Gruppe" der Weg, jemanden ohne Zustimmung in eine Liste zu ziehen. Entfreunden raeumt die
    gemeinsame Gruppen-Mitgliedschaft mit.
  - Upgrade zeigt nur die naechste Stufe (Standard->Creator, Creator->Business,
    Business->Business Plus), plus die Stufe danach als Ausblick OHNE Knopf. Vier Angebote
    gleichzeitig sind eine Preisliste; wer Standard ist, kann mit „5 Events hervorheben" nichts
    anfangen. Die Vorzugsliste zeigt nur, was NEU dazukommt (`newPerks`).
  - Praemien-Text: Titel/Beschreibung kommen aus der APP (`src/domain/rewards.ts`), Preis vom
    SERVER. Grund: Nur der Server darf ueber „reicht das Guthaben" entscheiden, also muss der
    angezeigte Preis der geprueft werdende sein – die Woerter dagegen gehoeren der
    Praesentationsschicht. Fuer unbekannte Slugs gilt der Servertext.
bugs, die dabei aufgefallen und behoben sind:
  - Der Server ist auf ASCII geschrieben (ae/oe/ue in Kommentaren UND Meldungen). Die
    Coupon-Titel gehen 1:1 als UEBERSCHRIFT in die App – im Browser stand „Ein Heissgetraenk
    bei einem teilnehmenden Cafe" und „GOe4Fun-Beutel". Jetzt echte Umlaute in
    server/src/rewards.js (Express setzt bei res.json() charset=utf-8) + der Merge oben als
    zweite Sicherung.
  - Restzeit einer Story war um 2 Stunden falsch („noch 25 Stunden" bei einer 24-Stunden-Story).
    Ursache ist projektweit und nicht in den Storys: `toIso` (server/src/db.js) haengt an einen
    DB-Zeitstempel schlicht ein 'Z' und behauptet damit UTC – `NOW()` liefert hier aber die
    ORTSZEIT (UTC+2). Die App rechnete `expires_at − jetzt` und lag um den Zonen-Versatz daneben.
    Fix ohne Eingriff in die Zeitzonen-Konvention: Eine Restzeit ist eine DAUER, und Dauern
    kennen keine Zeitzone. Der Server schickt `expires_in_minutes` per
    `TIMESTAMPDIFF(MINUTE, NOW(), expires_at)` – gegen dasselbe NOW(), mit dem er auch filtert,
    kann das per Konstruktion nicht auseinanderlaufen.
  - `accessibilityState={{ expanded }}` wird von react-native-web bei `role="button"` NICHT nach
    `aria-expanded` uebersetzt (im DOM stand nur role=button). Ein Screenreader konnte also nicht
    sagen, ob ein Settings-Bereich offen ist – „auf oder zu" waere eine rein visuelle Information
    (gedrehtes ›). `aria-expanded` jetzt ausdruecklich gesetzt, in setting-row, im
    Home-Aufklapper und in der (schon vorher betroffenen) activity-filter-bar. Gleiche Luecke,
    die segmented.tsx fuer `aria-selected` schon dokumentiert.
files (server):
  + server/src/rewards.js                   (Katalog, Buchungen, Nachtrag, Einloesen mit FOR UPDATE)
  + server/src/routes/rewards.js            (/me/rewards, /me/rewards/redeem)
  + server/src/routes/stories.js            (/stories + /:id/view + DELETE; 24 h; sweepExpired
     beim Lesen statt Cron; expires_in_minutes; Moderation vor dem Speichern wie bei Events)
  + server/src/routes/friends.js            (/friends, /groups samt Mitgliedern)
  ~ server/src/routes/profile.js            (GET /users?q= Nutzersuche mit Beziehungszustand;
     /users/:username fuer alle Stufen + shows_posts + friendship)
  ~ server/src/routes/activities.js         (Punkte-Buchung beim Anlegen, mit catch: das Event
     ist da, eine gescheiterte Buchung darf keinen Fehler zeigen – der Nachtrag holt sie)
  ~ server/schema.sql, server/src/db.js     (7 Tabellen: reward_points, reward_redemptions,
     stories, story_views, friendships, friend_groups, group_members – auch in ensureSchema,
     damit bestehende DBs sie beim Start bekommen)
  ~ server/src/app.js                       (drei Router eingehaengt)
files (app):
  + src/domain/rewards.ts                   (Katalog-Spiegel, nextGoal = guenstigster NOCH
     NICHT bezahlbarer Coupon – sonst zeigt die Startseite ewig auf den Kaffee)
  + src/domain/mascot-mood.ts               (Tab -> Stimmung + Satz; ERROR_REACTION)
  + src/domain/story.ts                     (STORY_HOURS, remainingLabel auf Minuten)
  + src/components/rewards-card.tsx         (Startseite; ersetzt streak-card)
  + src/components/story-rail.tsx           (Ringe; ungesehen = Verlauf, gesehen = Kontur)
  + src/components/story-viewer.tsx         (Modal ist hier RICHTIG: deckend schwarz, nichts
     weichzuzeichnen, und es ueberdeckt die native Tab-Leiste. Zeitleiste in Reanimated,
     Weiterschalten in setTimeout – getrennt, weil ein Callback aus dem Animationslauf zurueck
     nach JS auf Android gelegentlich verschluckt wird)
  + src/components/tab-mascot.tsx           (44 px, ohne Lichthof, neben seinem Satz)
  + src/app/rewards.tsx, src/app/create-story.tsx, src/app/(app)/friends.tsx
  - src/components/streak-card.tsx, src/domain/streak.ts(+test)  (Serie raus)
  ~ src/components/mascot.tsx               (Stimmung 'oops' mit abgeknickter Antenne;
     DAUERHAFTES Huepfen: zwei getrennte Laeufe statt withRepeat(reverse) – hoch bremst aus
     (Easing.out), runter beschleunigt (Easing.in), symmetrisch sah es wie ein Fahrstuhl aus.
     Huepfen und der Erfolgssprung ADDIEREN sich, sonst stockt die Figur im Erfolgsmoment.
     + MascotError)
  ~ src/components/ui/glow.tsx              (Pulse: Skalierung. Liegt INNEN, der Lichthof aussen –
     der Hof ist eine Geschwister-Ebene, mitskaliert wandert er unter dem Knopf hervor.
     1600 ms gegen 3600 ms beim Glow, damit sich die Kombination nicht sichtbar wiederholt)
  ~ src/components/ui/setting-row.tsx       (SettingGroup ausklappbar, Standard ZU; jede Gruppe
     haelt ihren Zustand selbst – ein Screen mit acht Zustaenden waechst mit jeder Gruppe)
  ~ src/app/(app)/index.tsx                 (Maskottchen + Story-Leiste + Praemien-Karte;
     Suche/Filter unter „Worauf hast du Lust?" und beim Zuklappen zurueckgesetzt, weil ein
     aktiver Filter hinter einer geschlossenen Klappe unsichtbarer Zustand waere; MascotError;
     FAB in Glow+Pulse; Beigaben-Abrufe mit eigenem catch, nur /activities darf den Screen kippen)
  ~ src/app/business.tsx (aus (app)/ heraus), app-tabs(.web), account-widget, _layout,
     settings, upgrade, profile/[username], progress, my-activities, activity-map(.web),
     create-activity (nennt die 10 Punkte), activity-filter-bar, lib/api.ts
tests: 181/181 App (neu: rewards 13, mascot-mood 4, story 6), 107/107 Server (neu: rewards-Katalog
  gegen den der App, dazu 21 Integrationstests gegen die echte DB fuer Punkte/Einloesen/
  Nachtrag/Freundschaft/Gruppen/Storys – die neue SQL war sonst ungeprueft). tsc 0, eslint 0.
  Web (Port 8091, eigene Konfiguration weil eine Parallel-Sitzung schon einen Server hielt):
  drei Wegwerf-Konten (danach geloescht) durch Startseite/Freunde/Settings/Praemien/Upgrade/
  Business/Storys, alle drei Stufen fuer das Upgrade durchgeschaltet, Einloesen mit echtem Code,
  Nutzersuche mit Beziehungszustand, Story angelegt+angesehen+Selbstschliessen, und der
  Fehlerzustand durch ein gekapertes fetch erzwungen (role=alert liest „Oh oh. Es ist ein Fehler
  aufgetreten. Aktivitaeten konnten nicht geladen werden."). 0 Konsolenfehler.
NICHT verifiziert: kein Durchgang am Handy – die native untere Leiste (5 Ziele, SF-Symbole) und die
  Bewegungen (Huepfen, Puls, Story-Zeitleiste) sind im Browser nicht pruefbar: die Pane ist
  ausgeblendet, damit tickt requestAnimationFrame nicht (deshalb steht in den Bildschirmtexten oben
  auch „0 erstellt" – CountUp bleibt auf dem Startwert stehen; die Werte selbst sind laut API
  richtig). Kein Bildschirmfoto aus demselben Grund. Die KI-Pruefung der Storys lief gegen kein
  echtes Modell (kein Schluessel in der Entwicklungsumgebung) – geprueft ist der Weg, nicht das
  Urteil. Das Bild einer Story wurde per API hochgeladen, nicht ueber Galerie/Kamera.

STEP 23a · app · branch main · Nachtrag: Maskottchen springt hoeher/schneller, Schatten bleibt liegen
grund: User: "Die Maskottchen koennen noch ein bisschen hoeher springen und bisschen schneller
  behalte aber den schatten auf der selben position".
umsetzung:
  ~ src/components/mascot.tsx  Hoehe 3,5 % -> 6 % der Figurhoehe (Schlaf 1,8 % -> 3 %), Dauer
     620/780 ms -> 460/560 ms (Schlaf 900/1000 -> 700/800). Der Schatten ist aus `MascotBody`
     heraus in ein eigenes `MascotShadow` gewandert: absolut positioniert, gleiche viewBox und
     Groesse, `pointerEvents: none`, VOR der Figur im Baum (liegt also dahinter).
warum der Schatten die eigentliche Aenderung ist: Er lag bisher IN derselben Ebene, die verschoben
  wird – damit wanderte das komplette Bild nach oben. Ohne einen Punkt, der liegen bleibt, liest
  eine Auf-und-ab-Bewegung als Wackeln und nicht als Sprung. Deshalb wirkt der Sprung jetzt
  deutlich hoeher als die 6 % allein erklaeren wuerden.
technisch: Transformationen aendern kein Layout, also bestimmt weiter die (nicht absolute)
  Figur-Ebene die Groesse des Elternteils – `StyleSheet.absoluteFill` auf dem Schatten deckt
  dadurch genau denselben Kasten. `DEFAULT_BODY` als Konstante, weil Figur und Schatten dieselbe
  Rueckfallfarbe brauchen und zwei Literale sonst irgendwann auseinanderlaufen.
tests: tsc 0, eslint 0, 181/181. Im Browser (Port 8091, Wegwerf-Konto, danach geloescht) die
  Ebenen-Struktur geprueft: zwei SVGs, Schatten 44x44 absolut und deckungsgleich mit dem
  Elternteil (also nicht kollabiert), 0 Ellipsen in der Figur-Ebene (kein Doppel-Schatten).
  Den Scheitelpunkt von Hand nachgestellt (translateY -2,64 px auf der Figur-Ebene): Figur
  verschiebt sich -2,64 px, Schatten 0 px – die Trennung greift.
NICHT verifiziert: die Bewegung selbst. Ausgeblendete Browser-Pane -> requestAnimationFrame
  tickt nicht, Reanimated steht still. Wie hoch und wie schnell es sich ANFUEHLT, kann nur der
  Blick aufs Geraet sagen.

STEP 23b · app · branch main · Maskottchen: Blinzeln, wandernder Blick, Winken, Gesichtswechsel
grund: User: "ich wuerde mir ausserdem wuenschen das die maskottchen herumschauen mit ihren augen
  und ausserdem gesticken machen und gesichter wechseln passend zum Tab und auch winken oder
  aehnliches".
architektur: Alles laeuft ueber ZUSAETZLICHE, absolut liegende Ebenen mit gewoehnlichem
  `transform` auf einer View – KEINE animierten SVG-Attribute. `cx` eines <Ellipse> liesse sich
  per `useAnimatedProps` bewegen, aber das ist der Weg, der im Web und ueber
  react-native-svg-Versionen hinweg am ehesten bricht. Dieselbe Technik wie beim Schatten in 23a,
  und sie ist dort schon belegt.
  Ebenen von hinten nach vorn:
    1. MascotShadow  – fest, bewegt sich nie (23a)
    2. Koerper-Ebene – Huepfen, Atmen, Nicken. `transformOrigin` unten Mitte, also da, wo die
       Figur steht: Mit dem voreingestellten Mittelpunkt liesse das Atmen sie auch nach unten
       wachsen, sie saenke in ihren eigenen Schatten.
    3. MascotArm     – NUR das rechte Aermchen, dreht um die Schulter (`shoulderOrigin`, in px
       umgerechnet, weil transformOrigin nicht in SVG-Einheiten rechnet). Liegt IMMER in dieser
       Ebene, auch ohne Geste: zwei Zeichenwege fuer "winkt"/"winkt nicht" waeren die Stelle, an
       der spaeter ein Arm fehlt.
    4. MascotEyes    – nur die Pupillen, nur bei offenen Augen (`OPEN_EYE_MOODS`). Blick als
       translate, Lidschlag als scaleY mit Bezugspunkt auf der Augenlinie.
entscheidungen:
  - Blinzeln und Blick sind KEINE Gesten. Sie laufen immer (bei offenen Augen), weil sie kein
    Ausdruck sind, sondern das Lebenszeichen – eine Figur, die minutenlang starrt, sieht aus wie
    ein Bild. Gesten (wave/look/nod/none) haengen dagegen am Tab.
  - Lid: zu in 70 ms, auf in 110 ms. Symmetrisch sieht es aus wie ein absichtliches Zwinkern.
    Die Pupille wird auf 0.06 gedrueckt und nicht auf 0 – bei 0 verschwinden die Augen fuer einen
    Moment ganz und das Gesicht wirkt leer statt geschlossen.
  - Blick laeuft `GAZE_STOPS` ab (links, rechts, hoch, Mitte). Die LETZTE Haltestelle ist mit der
    ersten identisch: Dadurch ist der Ruecksprung der Wiederholung unsichtbar, ohne dass die Augen
    quer zurueckrasen. Auf der Karte (`look`) groessere Auslenkung und kuerzere Pausen – dort IST
    Suchen die Taetigkeit.
  - Winken: heben, zweimal wedeln, senken – und dann eine LANGE Pause. Die Pause ist das
    Wichtigste: Ein Arm, der ohne Unterbrechung wedelt, ist nach zehn Sekunden Rauschen.
    Drehwinkel haengt an der Armhaltung (`WAVE_ANGLE`): haengende Arme -55 Grad, beim Jubeln nur
    -26 – derselbe Winkel wuerde den schon erhobenen Arm hinter den Kopf schwenken.
  - Nicken als Stauchen (translateY + scaleY 0.94), NICHT als Drehung: Die Figur hat keinen
    eigenen Kopf, eine Drehung waere ein Kippen zur Seite und liest sich als Zweifel statt als
    Zustimmung.
  - Eine eigene Phase je Figur (`useRef(Math.random())`), damit mehrere gleichzeitig sichtbare
    Maskottchen nicht im Gleichschritt blinzeln – das saehe nach Bildschirmfehler aus. Betrifft
    z. B. den Freunde-Tab, wo Kopfzeilen-Figur und Leerzustands-Figur zusammen im Bild sind.
  - Gesichtswechsel liegt in TabMascot, nicht in Mascot: Die Figur bleibt ein reiner Darsteller
    ("zeichne, was ich sage"), WANN welches Gesicht kommt, ist eine Frage des Auftritts. Alle 6 s,
    innerhalb des Charakters des Tabs (home happy<->idle, nicht happy<->asleep). Bei
    "Bewegung reduzieren" gar kein Wechsel: Ein Gesicht, das ohne Zutun umspringt, IST Bewegung.
    Der Zaehler startet beim Tabwechsel neu, damit jeder Tab mit seinem Hauptgesicht anfaengt.
files:
  ~ src/domain/mascot-mood.ts   (MascotGesture; `moods` je Tab statt einer Stimmung; `moodAt`
     laeuft im Kreis und vertraegt negative/krumme/unendliche Zaehler; `mood` bleibt als erstes
     Gesicht der Rueckfall)
  ~ src/components/mascot.tsx   (MascotEyes + MascotArm als neue Ebenen; blink/gaze/wave/nod;
     rechter Arm aus MascotBody heraus; Pupillen aus `faceFor` heraus; `gesture` an Mascot und
     MascotEmpty)
  ~ src/components/tab-mascot.tsx (Gesichtswechsel + Geste durchreichen)
  ~ src/components/activity-map.tsx, src/app/(app)/friends.tsx (Geste mitgeben)
tests: 186/186 App (5 neue in mascot-mood.test.ts: Hauptstimmung == erstes Gesicht, moodAt im
  Kreis, Zaehler-Robustheit, Gesten je Tab). tsc 0, eslint 0.
  Im Browser (Port 8091, Wegwerf-Konto, danach geloescht) die Geometrie EXAKT nachgemessen statt
  nur die Struktur geprueft – ueber getPointAtLength + getScreenCTM auf dem Arm-Pfad:
    Schulter (297.36, 221.06) -> (297.36, 221.06), also 0 Verschiebung; Hand hebt sich 4.31 px
    bei 44 px Figurgroesse. Vorausberechnet waren 4.36 px hoch und 0.7 px nach aussen, gemessen
    4.31 und 0.71 – die Drehung sitzt also wirklich auf der Schulter.
    Lidschlag: Pupillenhoehe 5.7 px -> 0.4 px, Blick seitlich -0.9 px, Koerper 0.
    Schulter-Drehpunkt folgt Stimmung UND Groesse: 33.0/21.04 px beim jubelnden 44er (viewBox
    69/44), 60.87/45.22 px beim nachdenklichen 80er (viewBox 70/52).
    Ebenen je Stimmung: 'cheer' 5 Koerperpfade + Arm-Ebene, KEINE Augen-Ebene (geschlossene
    Augen); 'thinking' 4 Koerperpfade + Arm-Ebene + Augen-Ebene mit 2 Ellipsen und 2 Kreisen.
  RUHEZUSTAND geprueft (der Fall "Animation laeuft nicht"): Arm identity, Augen identity, Koerper
  nur die Atem-Skalierung, alles sichtbar. Ohne Bewegung ist die Figur also eine vollstaendige,
  richtige Zeichnung – dieselbe Regel wie bei `entrance.tsx`: Bewegung darf verschoenern, nie
  tragen. 0 Konsolenfehler.
NICHT verifiziert: die Bewegungen im Lauf. Ausgeblendete Browser-Pane -> requestAnimationFrame
  tickt nicht, Reanimated steht still; geprueft ist die Geometrie an den Scheitelpunkten (von Hand
  gesetzt), nicht der Ablauf und nicht das Zusammenspiel der Zeiten. Wie oft es blinzelt und ob
  das Winken zu haeufig kommt, kann nur der Blick aufs Geraet sagen. `transformOrigin` als Array
  ist laut RN-Doku ab 0.76 dabei (hier 0.81) und im Web belegt – auf iOS/Android nicht selbst
  gesehen; faellt es aus, dreht der Arm um die Bildmitte (sichtbar schief, nichts kaputt).

STEP 23c · app · branch main · Absturz am Geraet: Nicht-Worklet im Worklet aufgerufen
grund: User: "DIe Expo App crasht aufeinmal wieso" – direkt nach STEP 23b.
ursache (belegt, nicht geraten): Der Rumpf von `useAnimatedStyle` IST ein Worklet und laeuft auf
  dem UI-Thread. In 23b standen dort zwei Dinge, die es dort nicht geben kann:
    src/components/mascot.tsx  armStyle:  `WAVE_ANGLE[armPose(mood)]`   <- armPose ist eine
      gewoehnliche Funktion. react-native-worklets 0.5.1 wirft dafuer
      "Tried to synchronously call a non-worklet function on the UI thread."
      (node_modules/react-native-worklets/src/valueUnpacker.ts:70 – nachgelesen, nicht vermutet).
    src/components/mascot.tsx  eyeStyle:  `GAZE_STOPS.map((s) => s.x)`  <- Rueckruf im Worklet;
      dieselbe Klasse, wenn auch nicht sicher toedlich.
  Warum es im Web durchlief: Dort gibt es keinen zweiten Thread, alles laeuft im JS-Kontext – das
  Worklet ist eine ganz normale Funktion. Genau deshalb hat die Web-Pruefung in 23b nichts
  gefunden, und genau deshalb stand dort "NICHT verifiziert: die Bewegungen im Lauf".
  Der Arm-Stil laeuft fuer JEDES Maskottchen, also auch fuer das auf der Startseite: Absturz
  unmittelbar nach dem Anmelden. Passt zu "auf einmal".
fix: Alles Gerechnete aus den Worklets heraus.
  ~ GAZE_X / GAZE_Y auf Modulebene als fertige Zahlenreihen (einmal gebaut statt pro Bild neu).
  ~ waveAngle im Komponentenkoerper nachgesehen, das Worklet sieht nur noch eine Zahl.
  Regel, die jetzt an `GAZE_X` dokumentiert steht: Im Worklet nur fertige Zahlen und
  `interpolate`. Alles, was gerechnet, nachgesehen oder abgebildet werden muss, passiert vorher.
absicherung: Statischer Durchlauf ueber ALLE Worklets in src/ (useAnimatedStyle,
  useDerivedValue, useAnimatedProps, useAnimatedReaction) nach Aufrufen, die dort nicht laufen
  duerfen – Rumpf ueber Klammerzaehlung abgegrenzt, Reanimated-Helfer und JS-Builtins als
  erlaubt gefuehrt. Ergebnis: nur noch ein Treffer, und der ist ein Fehlalarm aus einem
  Kommentar ("bleibt stehen ("). Die uebrigen Worklets (glow.tsx Glow/Pulse/PulseDot/Shimmer,
  story-viewer bar) nutzen ausschliesslich `interpolate` mit Zahlen.
  Ausserdem die zweite offene Frage aus 23a/23b geklaert: `transformOrigin` als Array ist in
  RN 0.81 unterstuetzt – processTransformOrigin.js nimmt `Array<string | number> | string` und
  ueberspringt bei einem Array den String-Zweig. War also nie das Problem.

STEP 23d · app · branch main · Story-Betrachter: Schliessen-Knopf bekam den Tipp nicht
grund: User: "manche zurück Button funktionieren noch nicht".
ursache: Die beiden Tippflaechen zum Blaettern lagen ZULETZT im Baum und wurden per `zIndex`
  unter Kopfzeile und Unterschrift geschoben. Fuers Zeichnen beachtet Android `zIndex`, fuer die
  Auswertung von Beruehrungen aber nicht durchgaengig – der Schliessen-Knopf lag sichtbar oben,
  der Tipp ging trotzdem an die Blaetterflaeche darunter. Zusaetzlich fing die Unterschrift
  (ein `View` ohne `pointerEvents`) das untere Drittel ab, wo man weiterblaettern will.
fix: Tippflaechen ZUERST in den Baum (liegen damit natuerlich hinten), `zIndex` ueberall
  entfernt, `pointerEvents="none"` auf die Unterschrift. Reihenfolge im Baum ist die Regel, die
  auf beiden Plattformen gleich gilt.
tests: tsc 0, eslint 0, 186/186. Web-Regression nach dem Worklet-Fix: Startseite baut auf,
  Maskottchen mit Arm-Ebene im Ruhezustand (identity), 0 Konsolenfehler.
NICHT verifiziert: dass der Story-Betrachter am GERAET der richtige Fund war – der Zusammenhang
  ist begruendet (Android + zIndex + Beruehrung), aber welche Zurueck-Knoepfe der User meint,
  ist noch offen. Nachgefragt.

STEP 23c · app · branch main · Jede Einstellungs-Gruppe sagt zugeklappt, was drin ist
grund: User: "in den einstellungen gebe fuer jeden ausklapbaren setting noch eine kurze
  beschreibung bevor man es ausklappt was dort angezeigt wird".
befund: `SettingGroup` konnte das schon (`hint`, steht unter der Ueberschrift und bleibt im
  ZUGEKLAPPTEN Zustand sichtbar) – benutzt haben es nur 2 von 8 Gruppen. Zugeklappt war der Rest
  also eine nackte Ueberschrift: "Standort & Privatsphaere" verraet nicht, dass Vibration und
  Klaenge da drin liegen. Kein neues Bauteil, nur die fehlenden Texte.
files:
  ~ src/app/(app)/settings.tsx        (hint an allen 8 Gruppen)
  ~ src/components/ui/setting-row.tsx (nur Doku am `hint`-Prop: welche Rolle der Text im
     zugeklappten Zustand hat – er ist dort das Einzige, was den Inhalt nennt)
  ~ .claude/launch.json               (expo-web-settings auf 8090; 8082 belegt von anderer Sitzung)
texte: Konto "E-Mail, Benutzername, Passwort und deine Kontostufe." · Interessen "Deine Themen – sie
  steuern, was dir auf der Startseite empfohlen wird." · Benachrichtigungen "Wofuer du Bescheid
  bekommst – Versand kommt noch, deine Auswahl merken wir uns." · Standort & Privatsphaere
  "Standort, Vibration, Klaenge, gespeicherte Zugangsdaten und der Datenschutz." · Darstellung
  "Hell, dunkel – oder wie dein Handy es gerade haelt." · Hilfe & Support "Haeufige Fragen,
  Feedback an uns und ein Problem melden." · Rechtliches "Nutzungsbedingungen, Impressum und die
  Version dieser App." · Konto beenden "Dein Konto samt Events und Verlauf endgueltig loeschen."
entscheidungen:
  - Konto bekommt einen hint, obwohl es offen startet: Man kann die Gruppe zuklappen, und dann
    steht dieselbe Frage im Raum wie bei den anderen. Der Kommentar im Screen sagt das jetzt so.
  - Der Text NENNT den Inhalt, er bewirbt ihn nicht ("Nutzungsbedingungen, Impressum und die
    Version" statt "Alles Rechtliche auf einen Blick") – man liest ihn, um zu entscheiden, ob man
    aufmacht, nicht um Stimmung zu bekommen.
  - Auf 2 Zeilen (Handybreite) begrenzt: Der Benachrichtigungs-Text war mit dem alten Satz 3
    Zeilen (Kopf 84 statt 64 px) und stand als einziger heraus. Gekuerzt, beide Aussagen bleiben
    drin (wofuer + Versand fehlt noch, Auswahl wird gemerkt).
  - hint bleibt auch im AUFGEKLAPPTEN Zustand stehen. Ihn dort auszublenden waere ein Sprung im
    Layout bei jedem Tipp, fuer nichts.
tests: tsc 0, eslint 0. Im Browser (Port 8090, Wegwerf-Konto hintcheck1, danach aus der DB
  geloescht) gemessen statt geraten:
    Alle 8 Koepfe 64 px hoch, hint genau 2 Zeilen a 20 px bei 302 px Textbreite, kein
    horizontaler Ueberlauf (scrollWidth == innerWidth == 491).
    Chevron bleibt mittig: (Chevron-Mitte - Kopf-Mitte) = 0.0 px bei allen 8, und der Textblock
    endet bei 328 px vor dem Chevron bei 336 px – kein Ueberlappen trotz zweiter Zeile.
    accessibilityLabel enthaelt die Beschreibung mit: aria-label="Konto. E-Mail, Benutzername,
    Passwort und deine Kontostufe." – Screenreader liest sie also vor dem Aufklappen.
    Der Text FAENGT KEINE TIPPS AB: Pointer-Folge auf die hint-Zeile von "Darstellung" ->
    aria-expanded false -> true, Inhalt gemountet (2 role=switch im Baum).
    Farbe unveraendert `textMuted` (#a3a3a3), Kontrast 7.85:1 gegen #0a0a0a. 0 Konsolenfehler.
NICHT verifiziert: das Aussehen als Bild. Screenshot braucht sichtbare Browser-Pane (hier
  ausgeblendet, document.hidden true) – geprueft sind Geometrie, Texte und Verhalten, nicht der
  Anblick. Beim Aufklappen bleibt der Inhalt in der ausgeblendeten Pane auf visibility:hidden
  stehen (FadeIn ohne rAF-Ticks), das ist die bekannte Umgebungs-Eigenart, nicht diese Aenderung.

STEP 23e · app · branch main · „Story erstellen": kein Weg zurueck ohne Verlauf
grund: User: "manche zurück Button funktionieren noch nicht" -> auf Nachfrage: "Story erstellen",
  und zwar "gar nichts" beim Antippen.
ursache: `router.back()` tut NICHTS, wenn der Verlauf leer ist – und genau dann zeigt der Stapel
  auch keinen Zurueck-Pfeil. Leer ist er, wenn expo-router die aktuelle Adresse als ERSTE Route
  herstellt: nach einem Neuladen (Fast Refresh, Absturz-Neustart, geteilter Link). Nach den
  Abstuerzen aus 23c ist genau das der wahrscheinliche Zustand gewesen.
  Belegt im Browser reproduziert: `/create-story` direkt geladen -> in der Kopfzeile ist
  ueberhaupt KEIN Zurueck-Element im Baum. Der Screen war eine Sackgasse.
  Dazu ein zweiter, gleichgelagerter Fehler im selben Screen: Nach dem Veroeffentlichen rief er
  `router.back()` ohne Rueckfall – ohne Verlauf blieb man also auf dem fertigen Formular stehen.
  create-activity hatte diesen Rueckfall (canGoBack -> replace('/')) schon; create-story nicht.
  Die Doppelung war der Grund, warum es nur an einer Stelle richtig war.
fix:
  + src/lib/go-back.ts            (`goBack()`: canGoBack ? back() : replace('/'). Ein Ort fuer
     die Entscheidung, statt sie je Screen neu zu treffen. Die Startseite ist festgenagelt: Sie
     ist der einzige Ort, von dem aus jeder andere erreichbar ist.)
  ~ src/app/create-story.tsx      (goBack nach dem Veroeffentlichen; zusaetzlich ein sichtbares
     „Abbrechen" IM Formular. Der Pfeil oben ist der native Knopf des Stapels und kann fehlen –
     dieser greift immer.)
  ~ src/app/create-activity.tsx   (eigene Kopie der Logik durch `goBack` ersetzt)
tests: tsc 0, eslint 0, 186/186. Im Browser den Fehlerfall nachgestellt (`/create-story` ohne
  Verlauf geladen): vorher kein Zurueck-Element, jetzt „Abbrechen" -> Klick fuehrt nach `/`, die
  Startseite baut auf. Der normale Weg (Startseite -> „Deine Story") hat weiter seinen
  Kopfzeilen-Pfeil mit `href="/"`.
NICHT behoben (bewusst, gleiche Falle): `/rewards`, `/business` und `/progress` sind reine
  Anzeige-Screens ohne eigenen Ausweg – startet die App direkt auf einer dieser Adressen, fehlt
  der Pfeil dort genauso. Ein „Abbrechen" waere in einer Anzeige falsch, der richtige Griff waere
  ein `headerLeft`-Rueckfall je Screen. Da es dort nur ueber einen geteilten Link oder ein
  Neuladen genau dieser Adresse auftritt, erst gemeldet statt still erweitert.

STEP 23d · app · branch main · Nachtrag: Beschreibungen der Einstellungs-Gruppen neu formuliert
grund: User: "Die Beschreibungen sind ziemloch schlecht und verwirrend bitte nochmal". Zu Recht –
  STEP 23c hatte je Gruppe eine INHALTSLISTE geschrieben ("Standort, Vibration, Klaenge,
  gespeicherte Zugangsdaten und der Datenschutz."): fuenf Nomen, kein Verb, und zwei Gruppen mit
  Gedankenstrich-Nachsatz ("Wofuer du Bescheid bekommst – Versand kommt noch, deine Auswahl merken
  wir uns.") – telegrammartig und ohne Bezug, solange die Gruppe zu ist.
regel jetzt: EIN Satz, der die TAETIGKEIT nennt, ueberall dieselbe Grammatik (Infinitiv am Ende),
  kein Gedankenstrich, EINZEILIG auf Handybreite (<= ~42 Zeichen bei 302 px Textbreite).
texte: Konto "E-Mail, Benutzername und Passwort aendern." · Interessen "Waehlen, was dir
  vorgeschlagen wird." · Benachrichtigungen "Festlegen, worueber wir dich informieren." ·
  Standort & Privatsphaere "Standort, Vibration und Klaenge einstellen." · Darstellung "Zwischen
  hell und dunkel wechseln." · Hilfe & Support "Antworten finden oder uns schreiben." ·
  Rechtliches "Nutzungsbedingungen und Impressum lesen." · Konto beenden "Dein Konto endgueltig
  loeschen."
files:
  ~ src/app/(app)/settings.tsx        (8 hints neu; RowNote am Fuss der Benachrichtigungen)
  + RowNote in src/components/ui/setting-row.tsx (Hinweis am Gruppenfuss, kein Eintrag, nicht
     antippbar; `note` ohne minHeight, damit es keine Trefferflaeche vorgibt)
  ~ src/components/ui/setting-row.tsx (Doku am `hint`-Prop: Form der Texte + warum Vorbehalte
     NICHT in den hint gehoeren)
entscheidungen:
  - Der Vorbehalt zu den Benachrichtigungen ("Versand wird gerade aufgebaut") ist aus dem hint in
    eine `RowNote` UNTEN in der Gruppe gewandert. Im hint stand er an der Stelle, an der man erst
    entscheidet, ob man aufmacht – dort ist es eine Warnung ohne Gegenstand. Bei den Schaltern,
    auf die er sich bezieht, ist er die Antwort auf die Frage, die man dort hat. Wortlaut wieder
    ganz: "Der Versand wird gerade aufgebaut. Deine Auswahl ist gespeichert und gilt, sobald es
    losgeht." – im Aufgeklappten ist Platz fuer den vollen Satz.
  - Einzeilig um den Preis von Details: "auf der Startseite" (Interessen) und die App-Version
    (Rechtliches) sind aus den Texten raus. Beides findet man drin; eine zweite Zeile pro Gruppe
    kostet mehr, als die Praezisierung bringt.
  - Zwei Gruppen fangen bewusst gleich an ("Waehlen, was …", "Festlegen, worueber …"): Die beiden
    sind die einzigen, in denen man Vorlieben setzt statt Daten zu aendern oder etwas zu lesen.
tests: eslint 0 auf beiden Dateien, tsc 0 (die 2 Fehler in src/app/create-story.tsx sind NICHT von
  hier – die Datei gehoert zur parallel laufenden Sitzung, beim ersten Lauf dieser Sitzung war tsc
  noch sauber).
  Im Browser (Port 8090, Wegwerf-Konto hintcheck2, danach aus der DB geloescht) nachgemessen:
    Alle 8 Beschreibungen EINZEILIG (Hoehe 20 px), alle Koepfe 44 px – vorher gemischt 44/64,
    weil 3 Texte umbrachen; die Liste hat jetzt einen Rhythmus. Kein Ueberlauf (scrollWidth ==
    innerWidth, 491 mobil / 750 desktop).
    Chevron mittig, Abweichung 0.0 px bei allen 8.
    Grenzwert gemessen statt geraten: 44 Zeichen brechen um, 42 nicht (302 px Textbreite) –
    "Themen waehlen, die dir vorgeschlagen werden." war 2 Zeilen, daher "Waehlen, was dir
    vorgeschlagen wird.".
    aria-label je Kopf = "Label. Beschreibung", z. B. "Konto. E-Mail, Benutzername und Passwort
    aendern." – Sprachausgabe hat sie vor dem Aufklappen.
    Tipp auf die Beschreibungszeile klappt weiter auf (aria-expanded false->true, 5 role=switch
    gemountet), der Text faengt also nichts ab.
    RowNote sitzt im Gruppen-Body UNTER der letzten Schalterzeile (y 1189 > Wochenrueckblick),
    14 px, textMuted (#737373 auf der Karte), und liegt NICHT in einem role=button – nichts,
    was aussieht wie ein Eintrag zum Antippen.
    0 Konsolenfehler.
NICHT verifiziert: das Aussehen als Bild (Screenshot braucht sichtbare Browser-Pane). Ob die
  Formulierungen TREFFEN, ist ohnehin Geschmack – gemessen ist nur, dass sie einzeilig sind,
  gleich gebaut und niemandem im Weg stehen.

STEP 24 · app+server · branch main · Profilbild und Banner selbst wechseln (Zahnrad -> Stift)
goal: In der User-Card der Profilseite fuehrte ein Zahnrad ins Konto-Blatt. Es wird ein Stift und
  oeffnet die BILDER der Karte: Profilbild und Banner. Der Banner ist das Bild, das
  weichgezeichnet HINTER der Karte liegt.
api (neu, alle geschuetzt, kein Stufen-Zwang):
  POST   /api/me/avatar  (multipart, Feld `image`) -> {user}
  DELETE /api/me/avatar                            -> {user}
  POST   /api/me/banner  (multipart, Feld `image`) -> {user}
  DELETE /api/me/banner                            -> {user}
  GET /api/users/:username -> user.banner neu; user.avatar jetzt volle Adresse
db: users.banner VARCHAR(255) NULL (schema.sql + ensureSchema-Nachtrag, idempotent)
files:
  + server/src/media.js                (publicBase + mediaUrl: relativer Pfad -> volle Adresse,
                                        fremde URLs unangetastet)
  ~ server/src/routes/profile.js       (IMAGE_KINDS, setProfileImage/clearProfileImage,
                                        storage/avatars + storage/user-banners, alte Datei weg)
  ~ server/src/auth.js                 (serializeUser/userPayload nehmen `req` -> Bild-Adressen)
  ~ server/src/routes/{auth,google,friends,progress,stories,admin,activities}.js
                                        (mediaUrl an allen avatar-Feldern; die drei lokalen
                                         publicBase-Kopien durch den Import ersetzt)
  ~ server/src/moderation.js           (context 'profile' + eigener Prompt: nur ein Bild)
  ~ server/src/db.js, server/schema.sql (banner-Spalte)
  ~ src/lib/api.ts                     (User.banner, PublicProfile.user.banner,
                                        api.setProfileImage / api.removeProfileImage)
  ~ src/lib/auth-context.tsx           (applyUser: Nutzer aus einer Antwort uebernehmen,
                                        ohne zweiten Netzaufruf wie refreshUser)
  ~ src/app/profile/[username].tsx     (Stift statt Zahnrad, EditorRow-Block in der Karte,
                                        Banner als weichgezeichnete Schicht, pickImage-Helfer)
  ~ server/test/api.test.js            (+9 Tests), .claude/launch.json (+expo-web-images:8096)
entscheidungen:
  - Bild-Pfad RELATIV in die DB, Adresse erst in der Antwort. Die Basis dieses Servers wechselt
    (Dev = WLAN-IP, siehe src/constants/config.ts); gespeicherte Volladressen zeigten nach jedem
    IP-Wechsel ins Nichts. Google-Avatare bleiben absolute URLs -> mediaUrl erkennt beides.
  - KEIN requireProfile auf den vier Endpunkten: Ein Gesicht gehoert zu jedem Konto. Die Stufe
    entscheidet ueber Beitraege und Social-Links, nicht ueber ein Profilbild.
  - KI-Verifizierung auch hier (context 'profile'), inkl. Auto-Sperre wie beim Beitrag: Das
    Profilbild ist das Erste, was andere sehen – es ungeprueft durchzulassen waere die
    offensichtlichste Luecke. Fehlerfeld ist immer `image`.
  - Banner liegt IN der Karte (erstes Kind, absolut) und nicht als Streifen darueber: Er ersetzt
    die Kartenfarbe, statt eine zweite Flaeche einzufuehren. Darauf zwei Schleier – glass.fill
    nimmt dem Foto den Kontrast, surface.chipBg gibt der Karte ihr Blau zurueck, sonst waere eine
    Karte mit Bild eine andere Karte als eine ohne.
  - `expo-image` NUR fuer den Banner: `blurRadius` gibt es dort auf Handy und im Web. Ueberhang
    von 24 px (BANNER_BLEED) schiebt den hellen Saum, den Weichzeichnen am Bildrand macht, aus
    der Karte – abgeschnitten wird er vom `overflow: 'hidden'` der Glasflaeche.
  - Konto & Einstellungen ist die LETZTE Zeile im Editor. Der Weg dorthin darf nicht wegfallen
    (die Startseite fuehrt hierher, nicht mehr ins Blatt), aber das Zahnrad am Knopf haette in
    die falsche Richtung gezeigt. Kostet einen Tipp mehr.
  - Ein `pickImage`-Helfer fuer alle drei Bilder der Seite (Beitrag, Profilbild, Banner). Im Web
    ohne Rueckfrage direkt in die Dateiauswahl: `Alert.alert` hat dort keine funktionierenden
    Knoepfe (lib/confirm.ts), die Frage "Galerie oder Kamera?" waere eine Sackgasse.
  - Waehrend ein Bild laeuft, sind BEIDE Zeilen gesperrt (`locked`): Zwei Uploads schicken zwei
    Konto-Antworten, die zweite ueberschriebe die erste.
tests: server 125/125 gruen (9 neu: Adresse ist absolut, Banner steht im oeffentlichen Profil,
  zweites Bild raeumt das erste von der Platte, DELETE loescht Datei + Eintrag, Standard-Konto
  darf, ohne Bild/falscher Typ = 422 auf `image`, ohne Anmeldung 401, /api/user liefert beide,
  ohne Bilder null). eslint 0 auf den drei App-Dateien, tsc 0 (der Fehler in
  src/components/app-tabs.web.tsx ist NICHT von hier – parallele Sitzung).
  Im Browser (Port 8096, Wegwerf-Konto bannerprobe, echter Upload ueber die API):
    Banner-<img> im DOM mit filter: blur(22px), object-fit: cover, 796x276 = Karte 748 + 2x24
    Ueberhang. Knopf-Label wechselt "Profil bearbeiten" <-> "Bearbeiten beenden".
    Editor zeigt: Profilbild aendern/entfernen, Banner aendern/entfernen, Konto & Einstellungen
    oeffnen (aria-label mit dem richtigen Verb, nicht "Konto & Einstellungen aendern").
    "Banner entfernen" getippt: <img> weg, Entfernen-Knopf weg, OHNE Neuladen – applyUser +
    lokaler Profil-Stand greifen. Konto-Blatt oeffnet aus der letzten Zeile.
NICHT verifiziert: der Upload-Weg ueber die Oberflaeche (Dateiauswahl des Browsers laesst sich
  nicht fernsteuern; der Endpunkt selbst ist per Test und per API-Upload belegt) und das Aussehen
  als Bild (Screenshot braucht sichtbare Browser-Pane). Auf dem GERAET ungetestet: Kamera-Weg,
  `blurRadius` unter Android.

STEP 25 · app+server · branch main · Admin: Storys loeschen + Kontostufen bestaetigen; Home in die Mitte
grund: User: "im admin pannel die möglichkeiten gibst storys zu löschen, und creator, business und
  business+ accounts zu bestätigen außerdem möchte ich das der Home Tab in der mitte der leiste ist
  und größer als die anderen".
rueckfrage (2 Optionen, User hat entschieden):
  - Bestaetigen = ANTRAGS-WARTESCHLANGE (nicht bloss "Stufe direkt setzen"): Person fragt in der App
    an, Admin bestaetigt/lehnt ab. Grund fuer die Rueckfrage: "bestaetigen" braucht etwas, das
    offen liegt – vorher ging der Weg per Support-Mail und es gab NICHTS zu bestaetigen. Nebenbei
    geschlossen: Ein Admin konnte die Stufe eines ANDEREN Kontos ueberhaupt nicht setzen
    (PATCH /api/user gilt nur fuer das eigene Konto, PATCH /api/admin/users/:id nur den Namen).
  - Tab-Leiste: NATIVE Leiste behalten (nicht auf eine selbstgebaute wechseln). Damit ist "groesser"
    ueber die ZEICHNUNG geloest, nicht ueber Layout – siehe unten.
db (neu): account_upgrade_requests (schema.sql + db.js/ensureSchema)
  id, user_id UNIQUE, requested_type, status ENUM(pending|approved|rejected), message(500),
  decided_by -> users ON DELETE SET NULL, decided_at, decision_note(255), created_at, updated_at
  EINE Zeile pro Konto (UNIQUE user_id) + ON DUPLICATE KEY UPDATE: zwei offene Anfragen desselben
  Kontos sind damit per Datenbank unmoeglich, ohne Nachsehen-dann-Einfuegen. Preis: kein Verlauf
  aelterer Anfragen (die Frage des Panels ist immer "was liegt JETZT offen").
api (neu):
  GET  /api/me/upgrade-request                      -> {data|null, requestable[]}
  POST /api/me/upgrade-request {account_type,message?} -> {data} 201  (nur nach OBEN, sonst 422)
  GET  /api/admin/stories                           -> {data[]}  (nur laufende; auch von gesperrten
       Konten; Bild-URL, Restzeit aus TIMESTAMPDIFF, views)
  GET  /api/admin/upgrade-requests                  -> {pending, data[]} (offen zuerst, aelteste oben)
  POST /api/admin/upgrade-requests/:id/approve      -> setzt users.account_type + status=approved
  POST /api/admin/upgrade-requests/:id/reject {reason?} -> status=rejected, Grund an die Person
  GET  /api/admin/stats  totals += {stories, pending_requests}
files:
  + server/src/routes/upgrades.js      (Nutzer-Seite + transformRequest, von admin.js mitbenutzt)
  ~ server/src/accounts.js             (REQUESTABLE_ACCOUNT_TYPES, requestableTypesFor)
  ~ server/src/routes/admin.js         (/stories, /upgrade-requests + approve/reject, stats-Zahlen)
  ~ server/src/app.js ; server/schema.sql ; server/src/db.js
  ~ server/test/api.test.js (+11 Tests) ; server/test/accounts.test.js (+2)
  + src/app/admin-stories.tsx          (Liste, Bild-Zoom, Loeschen mit Rueckfrage)
  + src/app/admin-requests.tsx         (Bestaetigen; Ablehnen als Blatt mit freiwilligem Grund)
  ~ src/app/admin-dashboard.tsx        (2 NavCards + rote Zahl bei offenen Anfragen; NavCard zeichnet
     das Symbol jetzt, vorher stand der NAME als Text davor: "users Alle Nutzer ansehen")
  ~ src/app/upgrade.tsx                (Anfrage in der App statt mailto; Stand offen/bestaetigt/
     abgelehnt+Grund; bei offener Anfrage KEIN zweiter Knopf)
  ~ src/lib/auth-context.tsx (refreshUser) ; src/lib/api.ts (Typen + 6 Endpunkte) ; src/app/_layout.tsx
  + scripts/make-tab-icons.mjs         (erzeugt alle Tab-Symbole; COVERAGE.home 0.98 vs rest 0.72)
  ~ assets/images/tabIcons/{home,map}.png*  - explore.png*  + people/list/gear.png*
  ~ src/components/app-tabs.tsx        (Reihenfolge Karte·Freunde·HOME·Aktivitaeten·Einstellungen,
     backBehavior="history")
  ~ src/components/app-tabs.web.tsx    (7 gleich breite Spalten, Home gross + Akzentfarbe)
entscheidungen:
  - REGISTRIERUNG bleibt unangetastet: 'creator' ist dort weiter Selbstbedienung
    (SELF_SERVICE_ACCOUNT_TYPES). Die Warteschlange deckt Anfragen AUS der App ab. Offene Luecke,
    bewusst und dem User gemeldet: Wer Creator will, kann sich ein neues Konto als Creator anlegen.
    Zumachen waere eine Zeile in accounts.js – kostet aber api.test.js (registerUser legt fast alle
    Testnutzer als 'creator' an und erstellt danach Events), deshalb nicht nebenbei.
  - Story-LOESCHEN laeuft ueber das bestehende DELETE /api/stories/:id (Admins duerfen dort schon
    jede Story, samt Bilddatei). Ein zweiter Admin-Endpunkt waere ein zweiter Weg, der auseinander
    laufen kann.
  - Abgelaufene Storys stehen NICHT in der Admin-Liste: Sie sind fuer niemanden mehr sichtbar,
    Loeschen waere Arbeit ohne Wirkung. Storys GESPERRTER Konten stehen drin (genau die will man).
  - Ablehnungsgrund freiwillig, nicht Pflicht: Ein Pflichtfeld haette hier "nein" als Grund erzeugt.
  - refreshUser in auth-context: Nach dem Bestaetigen aendert sich das Konto OHNE Zutun der Person.
    Ohne Abgleich waere Events-Erstellen freigeschaltet, der Knopf dafuer aber weiter versteckt.
    upgrade.tsx holt beim Oeffnen Anfrage UND /api/user.
  - FALLE dabei, beim Selbstlesen gefunden und behoben: `refreshUser` darf NICHT in den
    Abhaengigkeiten des `useCallback` stehen, das an `useFocusEffect` haengt. refreshUser setzt
    `user` (neues Objekt) -> der useMemo im Auth-Context baut seine Funktionen neu -> refreshUser
    hat eine neue Identitaet -> useFocusEffect laeuft erneut -> Endlos-Schleife aus
    /api/user-Aufrufen. Jetzt in einer Ref, `load` haengt nur noch am Token. Gemessen (fetch
    gezaehlt, 5 s nach dem Eintritt): genau 1x /api/user und 1x /me/upgrade-request, danach 0.
  - Warum "groesser" am Handy nur die Zeichnung ist: Ein einzelnes Feld der nativen Leiste laesst
    sich nicht vergroessern. Android skaliert jedes Bild in dasselbe 24-dp-Kaestchen, und die
    Schriftgroesse gilt fuer ALLE Beschriftungen zusammen (NativeTabsView liest
    tabBarItemTitleFontSize aus dem gerade aktiven Eintrag; die Zeile fuer FontSizeActive ist im
    Paket auskommentiert). Also: Haus fuellt sein Kaestchen (0.98), die anderen vier 0.72
    (Nadel 0.84 – schmale Form, sonst wirkt sie verloren). Gemessen: Home 22x23 px und ~312
    Deckungs-Pixel, die anderen 14-19 px Kante und 148-189.
  - backBehavior="history": Diese expo-router-Fassung uebergibt dem Router KEIN initialRouteName
    (NativeTabsNavigator ruft useNavigationBuilder ohne), als "erster" Tab gilt der zuerst
    deklarierte – seit der Umsortierung die Karte. Mit der Voreinstellung 'initialRoute' landete
    Zurueck auf der Karte statt auf Home.
  - Web: 7 gleich breite Spalten (Wortmarke + 5 Eintraege + leerer Platzhalter). Nur "mittig setzen"
    genuegte nicht – "Map" ist 61 px breit, "Einstellungen" 121, Home lag dadurch 39 px links der
    Mitte. Jetzt exakt: Slot-Mitte 640 = Leisten-Mitte 640.
tests: tsc 0, eslint 0, Server 125/125 (11 neu), Domain 186/186.
  Im Browser (Port 8094, Wegwerf-Konten pruefadmin/pruefuser/pruefstory + 2 Storys, danach alle aus
  der DB geloescht) durchgespielt statt geraten:
    Anfrage stellen (Standard -> Business, mit Begruendung) -> steht beim Admin ("1 offen"),
    Dashboard-Karte "1 Anfrage wartet auf dich" mit roter 1, stats.pending_requests >= 1.
    Ablehnen mit Grund -> Karte "Abgelehnt am 28.07.2026 von pruefadmin Pruef · Bitte erst ein
    Gewerbe nachweisen.", Kopf springt auf "Nichts offen"; beim Nutzer steht "Business wurde
    abgelehnt / Grund: ...".
    Erneut anfragen (Creator) -> Nutzer sieht "Creator angefragt" UND keinen Knopf mehr.
    Bestaetigen -> "Bestaetigt am 28.07.2026 von pruefadmin Pruef", /api/user account_type=creator,
    requestable = [business, business_plus].
    Storys: beide gelistet (Konto, Stufe, Zeit, Restzeit, Unterschrift, Ansichten), Loeschen nimmt
    genau eine Zeile weg ("2 sichtbar" -> "1 sichtbar"), abgelaufene fehlen (Server-Test).
    Tab-Leiste gemessen: Reihenfolge Map·Freunde·Home·Aktivitaeten·Einstellungen, alle 7 Spalten
    98 px, Home-Slot-Mitte 640 = Mitte der Leiste, Home-Flaeche 110x40 vs 28 hoch bei den anderen,
    16 px/700 in Akzentfarbe vs 14 px/500 grau.
NICHT verifiziert: die NATIVE Leiste am Geraet – Reihenfolge, Symbolgroessen und backBehavior sind
  aus dem Paketcode begruendet, aber Emulator/Handy stand hier nicht zur Verfuegung (launch.json
  kennt nur Web-Ziele). Ebenso ungeprueft als BILD: Screenshot braucht eine sichtbare Browser-Pane
  (hier ausgeblendet, deshalb auch kein rAF -> das Ablehnen-Blatt bleibt in der ausgeblendeten Pane
  unterhalb des Sichtbereichs stehen; das ist die bekannte Umgebungs-Eigenart, nicht der Screen).
  Die neuen Symbole sind als Alpha-Raster gemessen und als ASCII gesichtet, nicht als Bild beurteilt.

STEP 24a · app · branch main · Banner staerker weichgezeichnet + Zuschnitt beim Auswaehlen
files:
  ~ src/app/profile/[username].tsx  (BANNER_BLUR 22->32; BANNER_BLEED jetzt BANNER_BLUR*3 statt
     fester 24; CROP-Tabelle; pickImage nimmt crop-Optionen; Hinweiszeile im Editor)
entscheidungen:
  - Ueberhang wird BERECHNET (blur*3) statt gesetzt. Im Web ist `blurRadius` die Streuung σ einer
    Gauss-Glocke und reicht ~3σ weit; die alten festen 24 px haetten bei Radius 32 den
    durchsichtigen Saum wieder in die Karte geholt. Mit der Rechnung waechst er automatisch mit.
  - Zuschnitt = `allowsEditing` des Pickers, kein eigener Editor. Pro Bild ein Rahmen (CROP):
    avatar {aspect [1,1], shape 'oval'} – rundes Auswahlfenster passt zum runden Ring –,
    banner {aspect [16,9]}. `aspect`/`shape` greifen laut Typen von expo-image-picker 17.0.11 NUR
    auf Android; iOS schneidet mit allowsEditing immer quadratisch (fuer den Avatar richtig, beim
    Banner nimmt contentFit 'cover' danach den mittleren Streifen).
  - Beitrags-Foto bleibt OHNE Zuschnitt: kein fester Rahmen, und iOS wuerde jedes Querformat ins
    Quadrat zwingen. Der Helfer nimmt die Crop-Optionen deshalb als Parameter, nicht als Standard.
  - Der Hinweis "Nach dem Auswaehlen legst du den Ausschnitt fest." steht NUR am Geraet
    (Platform.OS !== 'web'): Der Dateidialog des Browsers hat keinen Zuschnitt, expo-image-picker
    verwirft die Option im Web still (ExponentImagePicker.web.js destrukturiert sie nicht).
tests: tsc 0, eslint 0. Im Browser (Port 8096, Wegwerf-Konto cropprobe, danach aus der DB
  geloescht): filter blur(32px), Bildbox 940x420 = Karte 748x228 + 2x96 Ueberhang, Hinweiszeile im
  Web NICHT im DOM, Editor-Zeilen unveraendert erreichbar.
NICHT verifiziert: der Zuschnitt selbst (System-UI von iOS/Android, am Geraet zu pruefen) und wie
  stark 32 px im Bild wirken (Screenshot braucht sichtbare Browser-Pane).
beobachtung: In storage/ lagen um 14:55/14:56 zwei fremde JPGs – Konto `admin` hat Avatar UND
  Banner gesetzt. Der Upload-Weg lief also von einem echten Client durch (nicht von hier).

STEP 25a · app+server · branch main · Registrierung: 'creator' war Selbstbedienung, jetzt nur Standard
grund: Die in STEP 25 offen gelassene Luecke, jetzt vom User beauftragt. SELF_SERVICE_ACCOUNT_TYPES
  hielt ['standard','creator'] -> REGISTRABLE_TYPES in routes/auth.js liess 'creator' bei der
  Registrierung durch. Damit war die Bestaetigung im Admin-Panel wertlos: ein neues Konto gleich als
  Creator anlegen ging schneller als eine Anfrage.
files:
  ~ server/src/accounts.js        (SELF_SERVICE_ACCOUNT_TYPES = ['standard'])
  ~ server/src/routes/auth.js     (REGISTRABLE_TYPES damit ['standard','personal']; Meldung fuer
     bekannte-aber-gesperrte Stufen umformuliert -> "Diese Stufe gibt es erst nach Freischaltung –
     frag sie in der App an." Die alte hiess "Business-Konten gibt es nur per Upgrade in der App"
     und traf jetzt auch 'creator')
  ~ server/test/accounts.test.js  (Test auf ['standard'] + neu: keine Stufe ist gleichzeitig
     Selbstbedienung UND anfragbar – die Luecke war genau diese Ueberschneidung)
  ~ server/test/api.test.js       (registerUser registriert IMMER 'standard' und hebt die Stufe
     danach per setAccountType; Registrierungs-Sperre prueft jetzt auch 'creator'; +1 Test: neues
     Konto ist Standard und darf keine Events anlegen)
  ~ src/app/(auth)/register.tsx   (Auswahl weg; "Konto-Typ" ist nur noch ein Textfeld: Standard +
     woher die hoeheren Stufen kommen)
entscheidungen:
  - registerUser NICHT als 'creator' registrieren und den 422 abfangen, sondern 'standard' + danach
    setAccountType (den Helfer gab es schon). Die ~100 Tests pruefen damit weiter, was sie pruefen
    wollen (Events, Business-Bereich, Boost, Storys), und der Weg ist derselbe, den ein Admin beim
    Bestaetigen nimmt. FALLE dabei: Die Antwort der Registrierung kennt nur 'standard' – der Helfer
    zieht body.user.account_type mit, sonst liest ein Test aus `user` eine andere Stufe als die DB
    (heute lesen alle Stufen-Pruefungen aus GET-Antworten, es waere also eine stille Falle fuer den
    naechsten Test gewesen).
  - Auswahl im Register-Screen ENTFERNT, nicht umformuliert ("Creator (nach Freischaltung)"): Bei
    einer Stufe gibt es nichts zu waehlen, und ein Knopf, den der Server mit 422 abweist, ist ein
    Weg in eine Fehlermeldung. Der Kasten bleibt als Text stehen, damit die Frage "welche Stufe
    werde ich?" beantwortet ist; Label/Satz kommen aus src/domain/account.ts (tierFor('standard')),
    damit hier keine zweite Beschreibung derselben Stufe entsteht.
  - errors.account_type wird weiter gerendert, obwohl er mit fester Stufe nicht mehr kommen kann:
    onSubmit setzt generalError NUR, wenn es keine Feldfehler gibt – ohne die Zeile waere ein
    account_type-Fehler ein stiller Fehlschlag (Knopf tut nichts, kein Text).
  - ASSIGNABLE_TYPES (PATCH /api/user, gilt nur fuer das eigene Konto) und
    REQUESTABLE_ACCOUNT_TYPES unberuehrt: Der Weg NACH OBEN bleibt offen – ein Admin setzt seine
    eigene Stufe frei und schaltet fremde per approve. Nur die Registrierung ist zu.
  - 'personal' bleibt registrierbar (Altwert installierter Builds, landet als 'standard').
  - Kein Aufraeumen bestehender Creator-Konten: Wer sich die Stufe vorher selbst gegeben hat,
    behaelt sie. Ein Ruecksetzen waere eine Entscheidung ueber echte Konten, nicht ein Bugfix.
    OFFEN und dem User gemeldet: Zurueckstufen gibt es dafuer auch keinen Weg. Ein Admin setzt eine
    FREMDE Stufe nur ueber approve (nach oben); PATCH /api/user gilt nur fuer das EIGENE Konto und
    PATCH /api/admin/users/:id schreibt ausschliesslich den username. Wer zurueckstufen will, muss
    heute an die DB.
tests: tsc 0, eslint 0, Server 127/127 (2 neu), Domain 186/186.
  Nicht geraten, sondern durchgespielt (expo web Port 8092, laufendes Backend 192.168.178.44:8000):
    /register zeigt "Konto-Typ / Standard / Mitmachen, entdecken, dabei sein." + Hinweis; KEINE
    Creator-Auswahl mehr im DOM.
    Wegwerf-Konto stufenprobe2607 per Formular angelegt -> 201, users.account_type='standard',
    is_admin=0; Home schreibt "Fuer eigene Events brauchst du ein Creator-Konto – tippe oben links
    auf Upgrade" (der neue Weg). Danach samt interest_user/Token aus der DB geloescht (0 Reste).
    POST /api/register mit account_type=creator direkt gegen den laufenden Server -> 422 mit der
    neuen Meldung, kein Nutzer angelegt.
  Kontrolle vorher: grep ueber das Repo – SELF_SERVICE_ACCOUNT_TYPES liest nur routes/auth.js
  (+ Tests). Die App-Seite (src/domain/account.ts) kennt den Begriff nicht, es gibt also keinen
  zweiten Ort, der jetzt auseinander laeuft.
NICHT verifiziert: der Screen am GERAET (nur Web gepruefte Fassung; das Feld ist Text, kein
  Eingabefeld – Tastatur/Fokus sind hier also nicht im Spiel). Und wie das Feld AUSSIEHT: Screenshot
  braucht eine sichtbare Browser-Pane, geprueft ist der DOM-Text.

---

STEP N · app+server · branch main (uncommitted)
goal: Gruppen-Chats + Event-Chats, Teilen von Events (Gruppe/WhatsApp/System), Rechtstexte IN der
  App (Impressum/Nutzungsbedingungen/Haftung/Regeln/Datenschutz), Melden+Blockieren, Merkliste;
  danach Aufraeumen nach TDD/SOLID.

## Chat-Kern (Server)
schema: + chat_rooms(kind,group_id UQ,activity_id UQ) + chat_messages(room_id,user_id,body,
  shared_activity_id SET NULL,shared_title) + chat_reads(room_id,user_id,last_read_id)
  DESIGN: Raum als EIGENE Zeile, nicht room_type/room_id an der Nachricht. Grund: FK kann nicht auf
  zwei Tabellen zeigen; so raeumt CASCADE (friend_groups/activities -> chat_rooms -> chat_messages)
  alles mit. Verifiziert: Konto loeschen -> 0 Raeume, 0 Nachrichten.
  shared_title = Schnappschuss (wie activity_history): Event geloescht -> activity_id NULL, Titel bleibt.
  chat_reads statt "gelesen von"-Zeile pro Nachricht: 50er-Gruppe waere 50 Zeilen/Nachricht.
files:
  + server/src/messaging.js (rein: ROOM_KINDS,parseMessageInput,nextBurst,pageLimit)
  + server/src/reports.js (rein: REPORT_TARGETS,REPORT_REASONS,parseReportInput)
  + server/src/people.js (USER_COLUMNS,transformUser,existingBetween,areFriends,blockExistsBetween,
    blockedIdsOf,loadUser,dropSharedGroupMemberships)  <- DIP: friends/groups/chat haengen daran
  + server/src/routes/chat.js ; + routes/groups.js (aus friends.js) ; + routes/reports.js
  ~ routes/friends.js (nur noch Freunde + /blocks) ; ~ routes/activities.js (is_saved, /saved, /:id/save)
  ~ routes/auth.js (terms_version+terms_accepted_at beim Register) ; ~ routes/admin.js (open_reports)
  ~ src/app.js (4 Router) ; ~ src/db.js (ensureSchema + 6 Tabellen + 2 Spalten)
api:
  GET  /api/chats -> [{kind,ref_id,title,members,last_message,unread}]  (auch stumme Chats!)
  GET  /api/chats/:kind/:refId/messages?after&before&limit ; POST dito {body?,activity_id?}
  POST /api/chats/:kind/:refId/read {message_id} ; DELETE /api/chats/messages/:id
  GET/POST/DELETE /api/blocks[/:userId] ; POST /api/reports ; GET/PATCH /api/admin/reports[/:id]
  GET /api/activities/saved ; POST|DELETE /api/activities/:id/save
  PATCH /api/groups/:id (umbenennen)
decisions:
  - Zugriff: Gruppe=Mitglied, Event=Host|Teilnehmer. 404 statt 403 (verraet die Existenz nicht).
  - Raum entsteht LAZY beim ersten Senden (INSERT IGNORE) -> kein "Gruppe ohne Chat"-Zustand.
  - Polling statt WebSocket (Express ohne Zustand). ?after=Cursor, 4 s, nur bei Fokus, kein Stapeln.
  - Bremse (10 Nachrichten/10 s) im SPEICHER, abgewiesene Versuche zaehlen NICHT mit.
  - Blockieren: beendet Freundschaft + gemeinsame Gruppen + filtert Nachrichten NUR fuer mich.
  - content_reports.target_id OHNE FK: Meldung muss das Loeschen ihres Gegenstands ueberdauern.
BUG (vom Integrationstest gefunden, nicht vom Auge):
  chat.js SELECT hatte m.id UND u.id -> mysql2 laesst die zweite gewinnen => jede Nachricht trug die
  USER-ID ihres Absenders. Loeschen/Melden liefen deshalb ins 404. Fix: AUTHOR_COLUMNS mit Aliassen,
  u.id ganz weg (m.user_id genuegt).
BUG: pageLimit('') -> Number('')===0 (endlich!) => ?limit= wurde als 1 gelesen statt als Vorgabe.

## App
files:
  + src/domain/{chat,share-activity,legal,report-reason,date-format}.ts (+ .test.ts je)
  + src/constants/operator.ts (Betreiberdaten, hasOperatorGaps) ; + src/lib/share.ts
  + src/app/{chat,chats,legal,blocked,admin-reports}.tsx
  + src/components/{share-sheet,report-sheet}.tsx
  + src/components/friends/{person-row,group-card,group-form}.tsx  <- friends.tsx 778 -> 621 Zeilen
  ~ activity-detail-modal.tsx (Teilen/Merken/Chat + Haftungs-Fussnote + Melden)
  ~ (app)/friends.tsx (Orchestrator), (app)/index.tsx (Regal "Gemerkt"), (app)/settings.tsx (Recht
    nach INNEN + blockierte Konten), (auth)/register.tsx (Zustimmung + LEGAL_VERSION),
    profile/[username].tsx (Melden/Blockieren), admin-dashboard.tsx (Karte Meldungen), icons/ui-icon (share)
decisions:
  - /legal liegt AUSSERHALB beider Stack.Protected: Die Zustimmung bei der Registrierung muss den
    Text verlinken koennen, und dort gibt es noch keinen Token.
  - Chats sind Stack-Routen, KEIN 6. Tab (app-tabs.tsx: Android faltet ab dem 6. in "More").
    Einstieg: Freunde-Kopfzeile (mit Gesamt-Ungelesen) + Gruppenkarte + Event-Popup.
  - Teilen: TEXT, kein Deep-Link (keine App-Links/Website vorhanden -> Link liefe ins Leere).
    wa.me/t.me statt whatsapp://: ohne App uebernimmt der Browser statt zu werfen.
  - Kein "Kopieren"-Ziel: waere expo-clipboard fuer etwas, das der System-Dialog schon anbietet.
  - LEGAL_VERSION als Datum in users.terms_version; acceptanceIsCurrent = strikter Gleichheitsvergleich.
  - OFFEN und dem User gemeldet: src/constants/operator.ts enthaelt PLATZHALTER (name, street, city,
    phone, responsible). hasOperatorGaps() zeigt deshalb einen Warnkasten im /legal-Screen.
cleanup (SOLID/DRY):
  - `const pad` + eigene formatDate/dateTime/date/shortDate/memberSince lagen in 12 Dateien, 3 davon
    zeichengleich. Jetzt src/domain/date-format.ts (12 Tests). 9 Dateien umgestellt; die 3
    verbliebenen `pad` (login-panel, create-activity, profile) brauchen es fuer anderes.
  - server/test/{reports,rewards}.test.js: process.cwd() -> import.meta.dirname (Test haengt sonst
    daran, aus welchem Ordner man startet).
tests: tsc 0, eslint 0, App 240/240 (54 neu), Server 168/168 (41 neu, davon 15 Integration gegen
  echte DB in test/chat.test.js).
  Durchgespielt (expo web 8082 + Backend 8000, zwei Wegwerf-Konten, danach geloescht):
    /legal + /legal?doc=liability: alle 5 Dokumente im DOM, Haftung mit 6 Abschnitten, 112/110,
      Freistellung, Querverweisen, Stand 2026-07-28, Platzhalter-Warnkasten.
    /chats: "Eine neue Nachricht wartet.", "Gruppen · 1", Vorschau "bodo Probe: ...", Plakette 1.
    /chat?kind=group&id=144: Kopfzeile+Gruppen-Chat, Trenner "Heute", Autor-Gruppierung greift
      (Bodos 2 Nachrichten EIN Name, eigene ohne Namen), Uhrzeiten, a11y-Label je Nachricht
      ("lang druecken zum Melden" vs "... zum Loeschen").
    Senden ueber die UI: Nachricht im Bild, Feld geleert, in der DB, is_mine=true.
    /friends: Chat-Einstieg, Gruppenkarte "2 Leute · von dir angelegt", "Chat oeffnen".
NICHT verifiziert: Handy (nur Web), Teilen-Blatt (Share/Linking gibt es im Web-Build nur als
  navigator.share-Fallback), Event-Chat mit echtem Event (Registrierung gibt nur 'standard', ein
  Event braucht Creator) – die Route ist aber durch test/chat.test.js abgedeckt.

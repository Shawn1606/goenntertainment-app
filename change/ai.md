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

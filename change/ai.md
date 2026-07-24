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

# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the backend (required — the app loads accounts/activities from it)

   The app talks to the Node backend in [`server/`](server/) on port `8000`.
   It does **not** start automatically. Run it in its own terminal:

   ```bash
   npm run server
   ```

   First-time DB setup (creates tables + seed data): apply `server/schema.sql`
   to the MySQL database `goenntertainment`, then run `npm run server:seed`.
   Config lives in `server/.env` (see `server/.env.example`).

3. Start the app (in a second terminal)

   ```bash
   npx expo start
   ```

If the app shows "Keine Verbindung zum Server", the backend in step 2 is not
running (or unreachable). See the "app can't reach the backend" section in
[`change/human.md`](change/human.md).

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

### Mail in development

Laravel (`api/`) sends 2FA codes and other mail over SMTP. In development a local
mail catcher, [Mailpit](https://github.com/axllent/mailpit), receives every mail, so
no code is ever written to a log:

```bash
docker compose -f dev/docker-compose.yml up -d
```

The inbox is at http://127.0.0.1:8025 (SMTP on 127.0.0.1:1025, both reachable only
from this PC). `api/.env.example` already points there. An older `api/.env` that
still uses the log mailer must take the `MAIL_*` lines from `api/.env.example`, and
an old `api/storage/logs/laravel.log` should be deleted: it can contain codes.

Without Docker, the Mailpit binary does the same: download it from the
[Mailpit releases](https://github.com/axllent/mailpit/releases) and run
`mailpit --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025`.

## Tests and checks

This is the one list of test suites and checks. CI runs all of them on every pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)); run them locally before you commit.
Every test file belongs to exactly one of these globs; a new suite or glob is added here and in
CI together.

| Suite or check | Test files | Command (from the repository root) | Needs |
|---|---|---|---|
| Client unit tests | `src/domain/*.test.ts` | `npm test` | Node >= 22.18 (runs the `.ts` files directly) |
| Typecheck | all `*.ts`/`*.tsx` in `tsconfig.json` | `npx tsc --noEmit` | `expo-env.d.ts` (see below) |
| Lint | `src/`, `app/`, `components/` (expo lint's default inputs; tooling under `scripts/` is not linted) | `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npm run lint` | |
| Expo SDK versions | | `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npx expo install --check` | |
| Server tests | `server/test/*.test.js` | `npm --prefix server test` | MySQL 8.4 with `server/schema.sql` loaded; `DB_*` in `server/.env` |
| `composer.lock` matches `composer.json` | | `cd api && composer validate --no-check-publish --strict` | PHP 8.4, Composer 2 |
| API tests | `api/tests/Unit/**/*Test.php`, `api/tests/Feature/**/*Test.php` | `cd api && php artisan test` | PHP 8.4, `composer install`, `api/.env` with a key |
| CI tooling tests | `scripts/ci/*.test.mjs` | `npm run test:tooling` | |
| Repository guardrails | | `node scripts/ci/check-repo.mjs` | |
| Schema drift tool tests | `scripts/schema-drift/*.test.mjs` | `node --test "scripts/schema-drift/*.test.mjs"` | Node >= 22.18, `npm --prefix server ci` |
| Schema drift check | | `node scripts/schema-drift/check.mjs` | Node >= 22.18, `npm --prefix server ci`, MySQL 8.4 and an account that may create databases (`SCHEMA_DRIFT_DB_HOST`, `_PORT`, `_USER`, `_PASSWORD`), PHP with `pdo_mysql`, `composer install` in `api/` |
| Workflow policy | | `node scripts/ci/check-workflows.mjs .github/workflows --ci-env deploy/ci.env` | |
| Versions shared by CI and the Dockerfiles | | `node scripts/ci/check-mirrors.mjs` | |
| Workflow lint | | actionlint, see [`.github/actionlint/Dockerfile`](.github/actionlint/Dockerfile) | Docker |
| Dependency audit | | `node scripts/ci/audit.mjs npm .`, `… npm server`, `… composer api` | network (registry); not blocking yet |
| Container smoke test | | [`.github/workflows/docker.yml`](.github/workflows/docker.yml) with [`deploy/ci.env`](deploy/ci.env) | Docker |

One-time setup per clone:

```bash
npm ci
npm --prefix server ci
(cd api && composer install && cp .env.example .env && php artisan key:generate)
# Generates the git-ignored expo-env.d.ts (and the typed-route declarations) for tsc:
EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npx expo customize tsconfig.json
```

The Expo CLI always runs with `EXPO_NO_TELEMETRY=1` and `EXPO_OFFLINE=1`, so it sends nothing
to Expo. In PowerShell set them first: `$env:EXPO_NO_TELEMETRY=1; $env:EXPO_OFFLINE=1`.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

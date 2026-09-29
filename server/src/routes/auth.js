import { Router } from 'express';
import { pool, first } from '../db.js';
import {
  createToken,
  checkPassword,
  hashPassword,
  userPayload,
  profileComplete,
  requireAuth,
  isBanned,
  banInfo,
} from '../auth.js';
import { Validator, HttpError, isEmail, isAlphaDash, missingIds } from '../validate.js';
import { ACCOUNT_TYPES, SELF_SERVICE_ACCOUNT_TYPES, normalizeAccountType } from '../accounts.js';
import { passwordProblem } from '../password-policy.js';
import { rejectBlockedTerms } from '../blocked-terms.js';

const router = Router();

/**
 * 'personal' ist der Wert, den die App vor den vier Kontostufen geschickt hat.
 * Wir nehmen ihn weiter an (installierte Builds sollen nicht bei der
 * Registrierung scheitern) und speichern ihn als 'standard'.
 */
const LEGACY_ACCOUNT_TYPE = 'personal';

/** Was man sich selbst geben darf – hoehere Stufen nur per Anfrage (siehe accounts.js). */
const REGISTRABLE_TYPES = [...SELF_SERVICE_ACCOUNT_TYPES, LEGACY_ACCOUNT_TYPE];

/** Was ein Admin per PATCH setzen darf. */
const ASSIGNABLE_TYPES = [...ACCOUNT_TYPES, LEGACY_ACCOUNT_TYPE];

async function tokenResponse(req, res, userRow, deviceName, status = 200) {
  const token = await createToken(userRow.id, deviceName || 'mobile');
  res.status(status).json({
    user: await userPayload(userRow, req),
    token,
    profile_complete: await profileComplete(userRow),
  });
}

// POST /api/register
router.post('/register', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);

    if (!b.name || typeof b.name !== 'string') v.add('name', 'Der Name ist erforderlich.');
    // Gesperrte Begriffe nach dem Format – wie in Laravel (NoBlockedTerms), damit
    // derselbe Wert auf beiden Wegen dieselbe Meldung bekommt.
    else rejectBlockedTerms(v, 'name', b.name, 'name');
    if (!b.username || typeof b.username !== 'string') {
      v.add('username', 'Der Benutzername ist erforderlich.');
    } else if (b.username.length < 3 || b.username.length > 30 || !isAlphaDash(b.username)) {
      v.add('username', 'Der Benutzername ist ungueltig (3-30 Zeichen, nur Buchstaben/Zahlen/-_).');
    } else {
      rejectBlockedTerms(v, 'username', b.username, 'username');
    }
    if (!isEmail(b.email)) v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
    // Grundregel, haeufige Passwoerter, Name/E-Mail im Passwort – siehe
    // src/password-policy.js (dieselbe Regel wie in Laravel).
    const passwordError = passwordProblem(b.password, {
      username: typeof b.username === 'string' ? b.username : null,
      email: typeof b.email === 'string' ? b.email : null,
    });
    if (passwordError) v.add('password', passwordError);
    // Unbekannte Werte werden abgewiesen statt stillschweigend auf Standard
    // gedreht: Ein Tippfehler im Client soll auffallen, nicht durchrutschen.
    if (!REGISTRABLE_TYPES.includes(b.account_type)) {
      v.add(
        'account_type',
        ACCOUNT_TYPES.includes(b.account_type)
          ? 'Diese Stufe gibt es erst nach Freischaltung – frag sie in der App an.'
          : 'Ungueltiger Kontotyp.',
      );
    }

    // Eindeutigkeit
    if (!v.errors.username && b.username) {
      if (await first('SELECT id FROM users WHERE username = ?', [b.username])) {
        v.add('username', 'Dieser Benutzername ist bereits vergeben.');
      }
    }
    if (!v.errors.email && isEmail(b.email)) {
      if (await first('SELECT id FROM users WHERE email = ?', [b.email])) {
        v.add('email', 'Diese E-Mail-Adresse ist bereits registriert.');
      }
    }

    const interests = Array.isArray(b.interests) ? b.interests.map(Number) : [];
    if (interests.length > 0 && (await missingIds('interests', interests)).length > 0) {
      v.add('interests', 'Mindestens ein Interesse existiert nicht.');
    }

    v.throwIfFails();

    const passwordHash = await hashPassword(String(b.password));

    /**
     * Stand der Nutzungsbedingungen, dem zugestimmt wurde.
     *
     * Kommt aus der App (`LEGAL_VERSION` in src/domain/legal.ts) und wird hier
     * NICHT geprueft: Der Server kennt den Text nicht und soll ihn nicht kennen –
     * er haelt fest, WAS bestaetigt wurde, damit sich nach einer Aenderung
     * erkennen laesst, wer noch dem alten Stand zugestimmt hat. Fehlt die Angabe
     * (aeltere App-Fassung), bleibt die Spalte NULL, und die App fragt beim
     * naechsten Start nach.
     */
    const termsVersion =
      typeof b.terms_version === 'string' && b.terms_version.trim()
        ? b.terms_version.trim().slice(0, 20)
        : null;

    const [result] = await pool.query(
      `INSERT INTO users
         (name, username, email, password, account_type, terms_version, terms_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${termsVersion ? 'NOW()' : 'NULL'}, NOW(), NOW())`,
      [
        b.name,
        b.username,
        b.email,
        passwordHash,
        normalizeAccountType(b.account_type),
        termsVersion,
      ],
    );

    if (interests.length > 0) {
      const rows = interests.map(() => '(?, ?, NOW(), NOW())').join(', ');
      const params = interests.flatMap((id) => [result.insertId, id]);
      await pool.query(
        `INSERT INTO interest_user (user_id, interest_id, created_at, updated_at) VALUES ${rows}`,
        params,
      );
    }

    const user = await first('SELECT * FROM users WHERE id = ?', [result.insertId]);
    await tokenResponse(req, res, user, b.device_name, 201);
  } catch (err) {
    next(err);
  }
});

// POST /api/login
router.post('/login', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);
    if (!isEmail(b.email)) v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
    if (!b.password) v.add('password', 'Das Passwort ist erforderlich.');
    v.throwIfFails();

    const user = await first('SELECT * FROM users WHERE email = ?', [b.email]);
    if (!user || !(await checkPassword(String(b.password), user.password))) {
      throw new HttpError(422, 'Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.', {
        email: ['Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.'],
      });
    }

    // Gesperrte Konten kommen nicht rein – mit Details (Grund/Dauer) fuer das Popup.
    if (isBanned(user)) {
      return res.status(403).json({ message: 'Dein Konto ist gesperrt.', ban: banInfo(user) });
    }

    /**
     * Zwei-Faktor-Konten bekommen HIER keinen Token.
     *
     * Den zweiten Schritt (Code pruefen) kann nur Laravel: Das TOTP-Secret ist
     * mit Laravels APP_KEY verschluesselt, und die Code-Hashes haengen am selben
     * Schluessel. Gaebe dieser Endpunkt nach dem Passwort einen Token heraus,
     * waere die ganze Zwei-Faktor-Anmeldung mit einem Aufruf direkt an Port 8001
     * umgangen – ein Passwort genuegte wieder.
     *
     * Die Pruefung steht bewusst NACH dem Passwort: Davor verriete die Antwort
     * jedem, der nur eine E-Mail-Adresse kennt, ob das Konto 2FA nutzt.
     */
    if (user.two_factor_method) {
      return res.status(403).json({ message: 'Bitte melde dich über die App an.' });
    }

    await tokenResponse(req, res, user, b.device_name);
  } catch (err) {
    next(err);
  }
});

// POST /api/logout  (geschuetzt)
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM personal_access_tokens WHERE id = ?', [req.tokenId]);
    res.json({ message: 'Abgemeldet.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/user  (geschuetzt)
router.get('/user', requireAuth, async (req, res, next) => {
  try {
    res.json({
      user: await userPayload(req.user, req),
      profile_complete: await profileComplete(req.user),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/user  (geschuetzt) – Profil bearbeiten (Name, Benutzername, E-Mail,
// Interessen; Kontotyp nur fuer Admins).
// Teil-Update: nur mitgeschickte Felder werden geaendert.
router.patch('/user', requireAuth, async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);
    const updates = {};

    if (b.name !== undefined) {
      if (!b.name || typeof b.name !== 'string') {
        v.add('name', 'Der Name ist erforderlich.');
      } else if (b.name === req.user.name || !rejectBlockedTerms(v, 'name', b.name, 'name')) {
        // Gesperrte Begriffe nur bei einem NEUEN Wert – wie in Laravel: Ein
        // Altname, den die Liste heute traefe, soll nicht jede andere Aenderung
        // am Profil blockieren.
        updates.name = b.name.trim();
      }
    }

    if (b.username !== undefined) {
      if (!b.username || typeof b.username !== 'string') {
        v.add('username', 'Der Benutzername ist erforderlich.');
      } else if (b.username.length < 3 || b.username.length > 30 || !isAlphaDash(b.username)) {
        v.add('username', 'Der Benutzername ist ungueltig (3-30 Zeichen, nur Buchstaben/Zahlen/-_).');
      } else if (b.username === req.user.username || !rejectBlockedTerms(v, 'username', b.username, 'username')) {
        updates.username = b.username;
      }
    }

    if (b.email !== undefined) {
      if (!isEmail(b.email)) {
        v.add('email', 'Bitte eine gueltige E-Mail-Adresse angeben.');
      } else {
        updates.email = b.email;
      }
    }

    // Kontostufe umstellen (Standard/Creator/Business/Business Plus). Bewusst
    // Admins vorbehalten: Die Stufe schaltet Rechte frei (Events erstellen,
    // Business-Bereich), die sich niemand im Selbstbedienungsverfahren geben
    // soll. Die Pruefung sitzt am Feld statt am ganzen Endpunkt –
    // Name/E-Mail/Interessen bleiben fuer alle offen.
    if (b.account_type !== undefined) {
      if (!req.user.is_admin) {
        throw new HttpError(403, 'Nur Admins duerfen den Kontotyp aendern.');
      }
      if (!ASSIGNABLE_TYPES.includes(b.account_type)) {
        v.add('account_type', 'Ungueltiger Kontotyp.');
      } else {
        updates.account_type = normalizeAccountType(b.account_type);
      }
    }

    // Interessen (optional): wenn mitgeschickt, wird die komplette Liste ersetzt.
    let interests = null;
    if (b.interests !== undefined) {
      if (!Array.isArray(b.interests)) {
        v.add('interests', 'Interessen muessen als Liste uebergeben werden.');
      } else {
        interests = [...new Set(b.interests.map(Number).filter(Number.isInteger))];
        if (interests.length > 0 && (await missingIds('interests', interests)).length > 0) {
          v.add('interests', 'Mindestens ein Interesse existiert nicht.');
        }
      }
    }

    // Eindeutigkeit pruefen (andere Nutzer), nur wenn Feld sich aendert.
    if (updates.username && updates.username !== req.user.username) {
      if (await first('SELECT id FROM users WHERE username = ? AND id <> ?', [updates.username, req.user.id])) {
        v.add('username', 'Dieser Benutzername ist bereits vergeben.');
      }
    }
    if (updates.email && updates.email !== req.user.email) {
      if (await first('SELECT id FROM users WHERE email = ? AND id <> ?', [updates.email, req.user.id])) {
        v.add('email', 'Diese E-Mail-Adresse ist bereits registriert.');
      }
    }

    v.throwIfFails();

    const fields = Object.keys(updates);
    if (fields.length > 0) {
      const setClause = fields.map((f) => `${f} = ?`).join(', ');
      const params = fields.map((f) => updates[f]);
      await pool.query(`UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ?`, [
        ...params,
        req.user.id,
      ]);
    }

    // Interessen komplett neu setzen (alte weg, mitgeschickte rein).
    if (interests !== null) {
      await pool.query('DELETE FROM interest_user WHERE user_id = ?', [req.user.id]);
      if (interests.length > 0) {
        const rows = interests.map(() => '(?, ?, NOW(), NOW())').join(', ');
        const params = interests.flatMap((id) => [req.user.id, id]);
        await pool.query(
          `INSERT INTO interest_user (user_id, interest_id, created_at, updated_at) VALUES ${rows}`,
          params,
        );
      }
    }

    const user = await first('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({
      user: await userPayload(user, req),
      profile_complete: await profileComplete(user),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

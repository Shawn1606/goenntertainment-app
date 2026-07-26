import { pool } from './db.js';

/**
 * Fehler-Sammler im Laravel-Format: { feld: ["Meldung", ...] }.
 * Wird bei 422 als { message, errors } zurueckgegeben – genau das erwartet die App.
 */
export class Validator {
  constructor(data) {
    this.data = data ?? {};
    this.errors = {};
  }

  add(field, message) {
    (this.errors[field] ??= []).push(message);
  }

  fails() {
    return Object.keys(this.errors).length > 0;
  }

  /** Wirft eine HttpError(422), wenn Fehler vorliegen. */
  throwIfFails() {
    if (this.fails()) {
      const message = Object.values(this.errors)[0]?.[0] ?? 'Die Angaben sind ungueltig.';
      throw new HttpError(422, message, this.errors);
    }
  }
}

/** Fehler mit HTTP-Status; wird zentral in index.js zu JSON. */
export class HttpError extends Error {
  constructor(status, message, errors = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const isAlphaDash = (v) => typeof v === 'string' && /^[\w-]+$/.test(v);

/** Alle IDs existieren in der Tabelle? Gibt die fehlenden zurueck. */
export async function missingIds(table, ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return [];
  }
  const placeholders = unique.map(() => '?').join(',');
  const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id IN (${placeholders})`, unique);
  const found = new Set((rows ?? []).map((r) => r.id));
  return unique.filter((id) => !found.has(id));
}

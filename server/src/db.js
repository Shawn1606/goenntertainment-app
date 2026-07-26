import 'dotenv/config';
import mysql from 'mysql2/promise';

/**
 * Verbindungs-Pool zur MySQL-Datenbank (dieselbe DB wie das alte Laravel-Backend).
 *
 * `dateStrings: true` liefert Datums-Spalten als roher String ('YYYY-MM-DD HH:MM:SS')
 * statt als JS-Date. So gibt es keine Zeitzonen-Verschiebung: Laravel speichert in UTC,
 * wir haengen beim Ausliefern einfach 'Z' an.
 */
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'goenntertainment',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

/** Kleiner Helfer: erste Zeile eines SELECTs oder null. */
export async function first(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] ?? null;
}

/** Wandelt eine DB-DateTime (UTC-String) in einen ISO-8601-String um. */
export function toIso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return `${String(value).replace(' ', 'T')}Z`;
}

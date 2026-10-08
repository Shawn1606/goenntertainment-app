/** „Lena Muster" → „LM", „lena" → „L", leer → „?". Für Profilbilder ohne Bild. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

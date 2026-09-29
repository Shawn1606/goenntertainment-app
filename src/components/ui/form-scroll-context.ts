import { createContext, useContext } from 'react';
import type { View } from 'react-native';

export type FormScrollApi = {
  /**
   * Schiebt `node` über die Tastaturoberkante, falls es verdeckt wäre.
   * Wird vom Feld beim Fokussieren gerufen.
   */
  ensureVisible: (node: View | null) => void;
};

/** Ohne Formular-Container passiert nichts – Felder laufen auch alleine. */
const STANDALONE: FormScrollApi = { ensureVisible: () => {} };

export const FormScrollContext = createContext<FormScrollApi>(STANDALONE);

export function useFormScroll(): FormScrollApi {
  return useContext(FormScrollContext);
}

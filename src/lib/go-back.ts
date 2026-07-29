/**
 * Zurück – auch dann, wenn es kein „zurück" gibt.
 *
 * ## Das Problem, das das löst
 *
 * `router.back()` tut **nichts**, wenn der Verlauf leer ist. Und genau das kommt
 * öfter vor, als man denkt: Nach einem Neuladen (Fast Refresh, Absturz, geteilter
 * Link) stellt expo-router die aktuelle Adresse als ERSTE Route her – unter
 * `/create-story` liegt dann nichts mehr. Der Bildschirm zeigt dann entweder gar
 * keinen Zurück-Pfeil oder einen, der ins Leere läuft, und die einzige Rettung ist,
 * die App neu zu starten.
 *
 * Deshalb hat jeder Weg zurück einen Rückfall: Gibt es keinen Verlauf, ersetzen wir
 * durch die Startseite. „Eine Ebene höher" ist immer noch eine sinnvolle Antwort
 * auf „zurück" – ein toter Knopf ist keine.
 *
 * Die Startseite ist bewusst festgenagelt und nicht ableitbar: Sie ist der einzige
 * Ort, von dem aus jeder andere erreichbar ist.
 */
import { router } from 'expo-router';

export function goBack(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/');
}

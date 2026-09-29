/**
 * Die Story einer Person direkt aus einer Liste ansehen.
 *
 * ## Warum ein Haken und keine Komponente
 *
 * Der Betrachter ist ein `Modal` und muss deshalb ganz unten im Screen stehen –
 * die Liste, aus der man ihn öffnet, steht ganz oben. Beides in eine Komponente
 * zu packen hieße, die Liste hineinzureichen; ein Haken gibt dem Screen genau die
 * zwei Teile, die er an zwei Stellen braucht: `open` für die Zeile und `viewer`
 * für das Ende der Seite.
 *
 * ## Erst beim Antippen laden
 *
 * Eine Personenliste weiß nur, DASS jemand etwas laufen hat (`PersonCard.story` –
 * Anzahl und „ungesehen"). Die Bilder holt dieser Haken beim Tipp nach. Der
 * umgekehrte Weg – jede Liste bringt alle Storys aller Leute mit – lädt vierzig
 * Bilder, damit man eines ansieht.
 *
 * ## Kein Umweg über das Profil
 *
 * Naheliegend wäre, aufs Profil zu springen und den Betrachter dort aufgehen zu
 * lassen. Dann blitzt aber eine Seite auf, die man nicht sehen wollte, und beim
 * Schließen steht man woanders als vorher. Der Betrachter gehört über die Liste,
 * aus der er kam.
 *
 * Nur wenn nichts (mehr) da ist, führt der Tipp aufs Profil: Zwischen dem Laden
 * der Liste und dem Tipp können 24 Stunden liegen, und ein schwarzes Fenster wäre
 * die schlechteste Antwort auf einen Ring, der eben noch da war.
 */
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import { StoryViewer } from '@/components/story-viewer';
import { groupStories } from '@/domain/story';
import { api, type PersonCard, type Story } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';

/** Was der Haken über eine Person wissen muss. */
export type PeekPerson = Pick<PersonCard, 'id' | 'name' | 'username'>;

export type StoryPeek = {
  /** Profilbild angetippt – lädt die Storys dieser Person und öffnet sie. */
  open: (person: PeekPerson) => void;
  /** Gehört ans Ende des Screens, damit das `Modal` über allem liegt. */
  viewer: React.ReactElement;
};

export function useStoryPeek({
  /**
   * Nichts (mehr) zu sehen – abgelaufen, gelöscht oder der Aufruf ging schief.
   * Der Screen führt dann üblicherweise aufs Profil.
   */
  onEmpty,
  /**
   * Eine Story dieser Person ist jetzt gesehen. Damit kann der Screen seinen Ring
   * ruhig stellen, ohne die ganze Liste neu zu laden.
   */
  onViewed,
}: {
  onEmpty?: (person: PeekPerson) => void;
  onViewed?: (userId: number) => void;
} = {}): StoryPeek {
  const router = useRouter();
  const { token } = useAuth();

  const [stories, setStories] = useState<Story[]>([]);
  const [open, setOpen] = useState(false);
  /**
   * Sperrt einen zweiten Tipp, während der erste lädt.
   *
   * Als `Ref` und nicht als State: Ein State-Update würde die Liste neu zeichnen,
   * und das für einen Zustand, den niemand sieht.
   */
  const loading = useRef(false);

  // Gebündelt wie überall (ein Ring je Person) – hier ist es immer genau eine
  // Gruppe, aber der Betrachter arbeitet auf Gruppen und soll für einen Sonderfall
  // keine zweite Form kennen.
  const groups = useMemo(() => groupStories(stories), [stories]);

  const openFor = useCallback(
    async (person: PeekPerson) => {
      if (!token || loading.current) return;
      loading.current = true;
      feedback.tapped();
      try {
        const res = await api.userStories(token, person.id);
        if (res.data.length === 0) {
          onEmpty?.(person);
          return;
        }
        setStories(res.data);
        setOpen(true);
      } catch {
        // Auch der Fehlerfall führt aufs Profil: Ein Tipp, der gar nichts tut,
        // sieht aus wie eine kaputte Zeile.
        onEmpty?.(person);
      } finally {
        loading.current = false;
      }
    },
    [token, onEmpty],
  );

  /**
   * Gesehen melden – und den Ring im Screen mit ruhig stellen.
   *
   * Ohne das lokale Setzen bliebe der Ring bunt, bis die Liste neu geladen wird;
   * ohne den Aufruf zum Server wäre die Story beim nächsten Laden wieder neu.
   */
  const onSeen = useCallback(
    (story: Story) => {
      setStories((prev) => prev.map((item) => (item.id === story.id ? { ...item, seen: true } : item)));
      onViewed?.(story.user.id);
      if (token) api.viewStory(token, story.id).catch(() => {});
    },
    [token, onViewed],
  );

  /** Vom Betrachter aufs Profil: erst schließen, sonst liegt das Modal darüber. */
  const onOpenProfile = useCallback(
    (story: Story) => {
      if (!story.user.username) return;
      setOpen(false);
      router.push({ pathname: '/profile/[username]', params: { username: story.user.username } });
    },
    [router],
  );

  const viewer = (
    <StoryViewer
      groups={groups}
      // `startGroup` ist die Position, nicht ein Schalter – bei einer Person ist
      // es immer die 0. `null` heißt geschlossen.
      startGroup={open && groups.length > 0 ? 0 : null}
      onClose={() => setOpen(false)}
      onSeen={onSeen}
      onOpenProfile={onOpenProfile}
    />
  );

  return { open: openFor, viewer };
}

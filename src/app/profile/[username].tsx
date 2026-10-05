/**
 * Profilseite: Stufe, Beiträge und Social-Links.
 *
 * Dieselbe Seite für beide Blickwinkel – man sieht sein eigenes Profil genau
 * so, wie andere es sehen. Was nur der eigenen Person gehört (schreiben,
 * löschen, Links pflegen), hängt an `profile.is_me` und steht zusätzlich da,
 * statt die Ansicht zu ersetzen.
 *
 * ## Jedes Konto hat eine Seite – aber nicht jede zeigt dasselbe
 *
 * Früher antwortete der Server für Standard-Konten mit 404. Seit die Nutzersuche
 * im Freunde-Bereich hierher führt, wäre das eine Sackgasse mitten im Ablauf:
 * Man findet jemanden, tippt drauf und landet bei „gibt es nicht". Es gibt die
 * Seite also für alle – was die Stufe entscheidet, ist der INHALT
 * (`profile.shows_posts`): Beiträge und Social-Links ab Creator, darunter eine
 * Visitenkarte mit Zahlen. Schreiben darf ohnehin nur, wer die Stufe hat; das
 * prüft der Server.
 */
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
// Nur für den Banner: `blurRadius` gibt es bei `expo-image` auf Handy UND im
// Web, bei RNs `Image` nicht überall. Alles andere hier bleibt RNs `Image`.
import { Image as BlurImage } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountSheet } from '@/components/account-widget';
import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { ProfilePostCard } from '@/components/profile-post-card';
import { StoryAvatar } from '@/components/story-avatar';
import { StoryViewer } from '@/components/story-viewer';
import { ThemedText } from '@/components/themed-text';
import { BrandButton } from '@/components/ui/brand-button';
import { GlassCard, GlassChip, SectionHeader } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { SocialIcon } from '@/components/ui/social-icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { Features } from '@/constants/features';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountAbilities, accountLabel, showsAdminBadge } from '@/domain/account';
import { groupStories } from '@/domain/story';
import type { UiIconName } from '@/domain/ui-icon';
import {
  MAX_LINK_LENGTH,
  SOCIAL_PLATFORMS,
  displaySocialLink,
  normalizeSocialInput,
  platformInfo,
  sortLinks,
} from '@/domain/social-links';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import {
  ApiError,
  api,
  type ProfileLink,
  type ProfilePost,
  type PublicProfile,
  type Story,
  type User,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { pickImage, type Picked } from '@/lib/pick-image';
import * as feedback from '@/lib/feedback';
import { goBack } from '@/lib/go-back';
import { ReportSheet } from '@/components/report-sheet';

/** Länge eines Beitrags – dieselbe Zahl wie in der Datenbank. */
const MAX_BODY = 1000;

/**
 * Wie stark der Banner verschwimmt.
 *
 * Der Banner ist Hintergrund, nicht Bild: Erkennbar sollen Farben und Stimmung
 * bleiben, nicht Gesichter oder Schrift. Zu wenig Weichzeichnung liest sich als
 * „Foto hinter dem Text" und macht jede Zeile darüber unruhig.
 */
const BANNER_BLUR = 32;

/**
 * Wie kräftig der Banner überhaupt durchkommt.
 *
 * Er lag vorher voll deckend hinter der Karte, und zwei Schleier darüber sollten
 * ihn bändigen. Das Ergebnis war beides zugleich zu viel: ein kräftiges Bild UND
 * eine milchige Schicht, die den Text trotzdem nicht rettete – Name, @Name und
 * die Zahlen gingen darin unter.
 *
 * Jetzt ist das Bild selbst durchsichtig und liegt damit da, wo ein Hintergrund
 * hingehört: als Farbstimmung hinter der Karte, nicht als zweites Motiv. Ein
 * Schleier genügt danach.
 */
const BANNER_OPACITY = 0.38;

/**
 * Der Banner ragt über die Karte hinaus.
 *
 * Weichzeichnen mischt jeden Bildpunkt mit seinen Nachbarn – am Bildrand fehlen
 * die, und dort bleibt ein durchsichtiger Saum. Ein Überhang schiebt ihn aus der
 * Karte heraus, wo ihn `overflow: 'hidden'` abschneidet.
 *
 * Der Faktor 3 ist nicht gewürfelt: Im Web ist `blurRadius` die Streuung σ einer
 * Gauß-Glocke, und die reicht rund 3 σ weit. Der Überhang muss also MIT dem
 * Radius wachsen – mit einer festen Zahl käme der Saum bei jeder Erhöhung wieder
 * in die Karte zurück.
 */
const BANNER_BLEED = BANNER_BLUR * 3;

/** Profilbild oder Karten-Hintergrund – beide laufen durch denselben Ablauf. */
type ProfileImageKind = 'avatar' | 'banner';

const IMAGE_LABEL: Record<ProfileImageKind, string> = {
  avatar: 'Profilbild',
  banner: 'Banner',
};

/**
 * Zuschnitt je Bild – der Rahmen, in dem es später steckt.
 *
 * `shape: 'oval'` nur beim Profilbild: Es sitzt in einem runden Ring, und ein
 * rundes Auswahlfenster zeigt genau das, was hinterher übrig bleibt.
 *
 * Beides greift NUR auf Android. iOS schneidet mit `allowsEditing` immer
 * quadratisch zu (`aspect` und `shape` sind dort ohne Wirkung) – für das
 * Profilbild ist das genau richtig, beim Banner nimmt `contentFit: 'cover'`
 * anschließend den mittleren Streifen. Im Web gibt es keinen Zuschnitt: Der
 * Dateidialog des Browsers kennt keinen, `expo-image-picker` wirft die Option
 * dort still weg.
 */
const CROP: Record<ProfileImageKind, { aspect: [number, number]; shape?: 'oval' }> = {
  avatar: { aspect: [1, 1], shape: 'oval' },
  banner: { aspect: [16, 9] },
};



/**
 * Außendurchmesser des Profilbildes inklusive Story-Ring.
 *
 * Etwas größer als die 64 von früher: Der Ring ist breiter geworden und liegt
 * INNEN – ohne die zusätzlichen Punkte hätte das Gesicht verloren, was der Ring
 * gewonnen hat.
 */
const AVATAR = 72;

/**
 * Ein Profil ohne Storys – als KONSTANTE, nicht als `[]` im Aufruf.
 *
 * `useMemo` vergleicht seine Abhängigkeiten mit `===`. Ein frisches `[]` bei
 * jedem Durchlauf wäre jedes Mal ein neuer Wert, und der Speicher wäre für nichts.
 */
const NO_STORIES: Story[] = [];

const pad = (n: number) => String(n).padStart(2, '0');

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/**
 * ISO-Datum → „TT.MM.JJJJ". Bewusst OHNE `Intl`/`toLocaleDateString`: Hermes
 * bringt die Sprachdaten nicht überall mit, dann stünde hier ein englisches
 * Datum. Dieselbe Entscheidung wie in components/activity-detail-modal.tsx.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** ISO-Datum → „Juli 2026" (ebenfalls ohne `Intl`). */
function fmtMonth(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const insets = useSafeAreaInsets();
  // Die Kopfzeile ist durchsichtig und liegt ÜBER dem Inhalt – ihre Höhe wird
  // deshalb unten als Innenabstand gebraucht, sonst startet die erste Karte
  // hinter dem Namen. Kommt aus dem Navigations-Paket, weil sie je nach
  // Plattform, Statusleiste und Schriftgröße anders ausfällt.
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const surface = useBrandSurface();
  const glass = useGlass();
  // `user` wird hier nicht mehr gebraucht: Wer das Profil sieht und wer es
  // besitzt, sagt die Antwort selbst (`is_me`, `shows_posts`) – und die weiß es
  // genauer als der lokale Zustand.
  const { token, logout, applyUser } = useAuth();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Konto-Blatt: Der Knopf oben rechts führt jetzt hierher statt zum Blatt –
   *  Einstellungen, Admin-Bereich und Abmelden müssen trotzdem erreichbar sein. */
  const [accountOpen, setAccountOpen] = useState(false);
  /** Was das Konto-Blatt auf Android weichzeichnet (siehe `HomeBackground`). */
  const blurTarget = useRef<View>(null);

  /** Bilder der Karte bearbeiten (Profilbild und Banner). */
  const [editOpen, setEditOpen] = useState(false);
  /** Welches Bild gerade unterwegs ist – sperrt beide Zeilen und zeigt den Dreher. */
  const [imageBusy, setImageBusy] = useState<ProfileImageKind | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Beitrag verfassen
  const [body, setBody] = useState('');
  const [image, setImage] = useState<Picked | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Links bearbeiten
  const [linksOpen, setLinksOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingLinks, setSavingLinks] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  /** Sperrt den Freundschafts-Knopf, solange der Aufruf läuft. */
  const [friendBusy, setFriendBusy] = useState(false);
  /** Dasselbe für den Folgen-Knopf – die beiden sperren sich nicht gegenseitig. */
  const [followBusy, setFollowBusy] = useState(false);

  /** Melde-Blatt offen? */
  const [reporting, setReporting] = useState(false);

  /** Story-Betrachter offen? Der Ring um das Profilbild öffnet ihn. */
  const [storyOpen, setStoryOpen] = useState(false);

  /**
   * Die laufenden Storys dieser Person – sie kommen mit dem Profil (siehe
   * `PublicProfile.stories`), nicht aus einem zweiten Aufruf. Gebündelt wie
   * überall: eine Gruppe je Person, hier also genau eine.
   */
  const stories = profile?.stories ?? NO_STORIES;
  const storyGroups = useMemo(() => groupStories(stories), [stories]);

  /**
   * Konto blockieren.
   *
   * Danach geht es zurück: Die Person ist ab jetzt aus der App verschwunden, und
   * auf ihrem Profil zu bleiben wäre ein Widerspruch dazu. Die Rückfrage sagt
   * ausdrücklich, dass die Freundschaft dabei endet – das ist der Teil, den man
   * sonst erst hinterher merkt.
   */
  async function onBlock() {
    if (!token || !profile || profile.is_me) return;
    const ok = await confirmAction(
      `${profile.user.name} blockieren`,
      'Die Person kann dich danach nicht mehr finden, anfragen oder anschreiben. Eine bestehende Freundschaft und gemeinsame Gruppen enden dabei.',
      'Blockieren',
      true,
    );
    if (!ok) return;

    try {
      await api.blockUser(token, profile.user.id);
      feedback.left();
      goBack();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.');
    }
  }

  const load = useCallback(async () => {
    if (!token || !username) return;
    setError(null);
    try {
      setProfile(await api.profile(token, username));
    } catch (err) {
      setProfile(null);
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Dieses Profil gibt es nicht.'
          : 'Profil konnte nicht geladen werden.',
      );
    } finally {
      setLoading(false);
    }
  }, [token, username]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /** Foto für einen Beitrag aussuchen. */
  async function chooseImage() {
    const picked = await pickImage('Foto zum Beitrag', 'post');
    if (picked) setImage(picked);
  }

  /**
   * Profilbild oder Banner austauschen.
   *
   * Zwischen Auswahl und Upload liegt der Zuschnitt (`CROP[kind]`): Das Bild
   * landet in einem festen Rahmen, den Ausschnitt soll deshalb wählen, wer das
   * Bild aussucht – und nicht `contentFit: 'cover'` erraten.
   *
   * Der Server prüft das Bild vor dem Speichern (KI-Verifizierung) und antwortet
   * mit dem fertigen Konto – deshalb steht danach kein Nachladen, sondern das
   * Übernehmen dieser Antwort.
   */
  async function onChangeImage(kind: ProfileImageKind) {
    if (!token || imageBusy) return;
    const picked = await pickImage(IMAGE_LABEL[kind], kind, CROP[kind]);
    if (!picked) return;

    setImageBusy(kind);
    setImageError(null);
    try {
      const { user: updated } = await api.setProfileImage(token, kind, picked);
      adoptUser(updated);
    } catch (err) {
      await reportImageError(err, `Das ${IMAGE_LABEL[kind]} konnte nicht gespeichert werden.`);
    } finally {
      setImageBusy(null);
    }
  }

  /** Bild wieder abnehmen. Rückfrage, weil das Bild danach weg ist. */
  async function onRemoveImage(kind: ProfileImageKind) {
    if (!token || imageBusy) return;
    const label = IMAGE_LABEL[kind];
    const ok = await confirmAction(`${label} entfernen`, `Soll dein ${label} weg?`, 'Entfernen', true);
    if (!ok) return;

    setImageBusy(kind);
    setImageError(null);
    try {
      const { user: updated } = await api.removeProfileImage(token, kind);
      adoptUser(updated);
    } catch (err) {
      await reportImageError(err, `Das ${label} konnte nicht entfernt werden.`);
    } finally {
      setImageBusy(null);
    }
  }

  /**
   * Neuen Kontostand an BEIDEN Stellen übernehmen.
   *
   * Einmal im Konto – davon leben Kopfzeile und Konto-Blatt – und einmal in
   * dieser Seite: Ihr Profil kommt aus `/api/users/:name` und bekäme die
   * Änderung sonst erst beim nächsten Laden mit.
   */
  function adoptUser(updated: User) {
    applyUser(updated);
    setProfile((current) =>
      current
        ? {
            ...current,
            user: { ...current.user, avatar: updated.avatar, banner: updated.banner ?? null },
          }
        : current,
    );
  }

  /**
   * Fehler eines Bild-Aufrufs anzeigen.
   *
   * Sonderfall wie beim Beitrag: Stuft die KI-Verifizierung das Bild als nicht
   * jugendfrei ein, ist das Konto ab sofort gesperrt und der Token entwertet –
   * dann hilft keine Meldung im Formular, sondern nur Grund nennen und abmelden.
   */
  async function reportImageError(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      const ban = err.status === 403 ? err.body?.ban : undefined;
      if (ban) {
        await notifyUser(
          'Konto gesperrt',
          [
            ban.reason ?? 'Dein Bild war nicht jugendfrei.',
            ban.banned_until ? `\nGesperrt bis: ${fmtDate(ban.banned_until)}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
          'Verstanden',
        );
        await logout();
        return;
      }
      setImageError(err.firstError());
      return;
    }
    setImageError(fallback);
  }

  async function onPublish() {
    if (!token || posting) return;
    const text = body.trim();
    if (!text) {
      setPostError('Schreib etwas, bevor du den Beitrag veröffentlichst.');
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      const { data } = await api.createPost(token, text, image);
      setBody('');
      setImage(null);
      // Ohne Nachladen: Der neue Beitrag gehört nach oben.
      setProfile((current) =>
        current
          ? {
              ...current,
              posts: [data, ...current.posts],
              stats: { ...current.stats, posts: current.stats.posts + 1 },
            }
          : current,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        // Nicht jugendfreier Inhalt + automatische Sperre: Der Token ist ab
        // sofort entwertet – Grund zeigen und lokal abmelden, sonst laufen
        // alle weiteren Anfragen ins Leere. Gleiches Vorgehen wie beim Event.
        const ban = err.status === 403 ? err.body?.ban : undefined;
        if (ban) {
          await notifyUser(
            'Konto gesperrt',
            [
              ban.reason ?? 'Dein Inhalt war nicht jugendfrei.',
              ban.banned_until ? `\nGesperrt bis: ${fmtDate(ban.banned_until)}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            'Verstanden',
          );
          await logout();
          return;
        }
        setPostError(err.firstError());
      } else {
        setPostError('Beitrag konnte nicht veröffentlicht werden.');
      }
    } finally {
      setPosting(false);
    }
  }

  async function onDeletePost(post: ProfilePost) {
    if (!token) return;
    const ok = await confirmAction('Beitrag löschen', 'Soll dieser Beitrag weg?', 'Löschen');
    if (!ok) return;
    try {
      await api.deletePost(token, post.id);
      setProfile((current) =>
        current
          ? {
              ...current,
              posts: current.posts.filter((p) => p.id !== post.id),
              stats: { ...current.stats, posts: Math.max(0, current.stats.posts - 1) },
            }
          : current,
      );
    } catch {
      await notifyUser('Fehlgeschlagen', 'Der Beitrag ließ sich nicht löschen.');
    }
  }

  /** Öffnet den Link-Editor mit dem aktuellen Stand als Vorbelegung. */
  function openLinks(current: ProfileLink[]) {
    const next: Record<string, string> = {};
    current.forEach((link) => {
      // Vorbelegt wird die KURZE Form („@name"), nicht die volle Adresse –
      // genau das, was man auch selbst eintippen würde. Beim Speichern wird
      // daraus wieder dieselbe Adresse.
      next[link.platform] = displaySocialLink(link.platform, link.url);
    });
    setDrafts(next);
    setLinkError(null);
    setLinksOpen(true);
  }

  async function onSaveLinks() {
    if (!token || savingLinks) return;
    const links: ProfileLink[] = [];

    for (const platform of SOCIAL_PLATFORMS) {
      const raw = (drafts[platform.key] ?? '').trim();
      if (!raw) continue;
      const result = normalizeSocialInput(platform.key, raw);
      if (!result.ok) {
        setLinkError(`${platform.label}: ${result.error}`);
        return;
      }
      links.push({ platform: platform.key, url: result.url });
    }

    setSavingLinks(true);
    setLinkError(null);
    try {
      const saved = await api.saveLinks(token, links);
      setProfile((current) => (current ? { ...current, links: saved.links } : current));
      setLinksOpen(false);
    } catch (err) {
      setLinkError(
        err instanceof ApiError ? err.firstError() : 'Links konnten nicht gespeichert werden.',
      );
    } finally {
      setSavingLinks(false);
    }
  }

  async function openLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      await notifyUser('Link ließ sich nicht öffnen', url);
    }
  }

  /** Freundschaft anfragen, annehmen oder beenden – je nach Zustand. */
  async function onFriendAction() {
    if (!token || !profile || friendBusy) return;
    setFriendBusy(true);
    try {
      const state = profile.friendship ?? 'none';
      if (state === 'friends' || state === 'outgoing') {
        await api.removeFriend(token, profile.user.id);
        setProfile((current) => (current ? { ...current, friendship: 'none' } : current));
      } else {
        const res = await api.addFriend(token, profile.user.id);
        setProfile((current) => (current ? { ...current, friendship: res.status } : current));
      }
    } catch (err) {
      await notifyUser(
        'Fehlgeschlagen',
        err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.',
      );
    } finally {
      setFriendBusy(false);
    }
  }

  /**
   * Die Kopfzeile – durchsichtig, aber vollständig.
   *
   * `headerTransparent` nimmt der Leiste ihre Fläche und ihre Trennlinie; Name
   * und Zurück-Knopf bleiben. Der Inhalt läuft dann UNTER ihr durch, deshalb
   * unten `paddingTop: headerHeight` – ohne das läge die erste Karte hinter dem
   * Namen.
   *
   * `headerShadowVisible: false` ist nötig, nicht Geschmack: Android zeichnet
   * sonst weiter den Schlagschatten der Leiste, und dann schwebt eine unsichtbare
   * Kante über der Seite.
   */
  /**
   * Folgen bzw. nicht mehr folgen.
   *
   * Bewusst getrennt vom Freundschafts-Knopf: Folgen ist einseitig und braucht
   * niemandes Zustimmung, eine Freundschaft schon. Die Antwort bringt beide
   * Zahlen frisch mit – gezählt wird also nicht in der App.
   */
  async function onFollowAction() {
    if (!token || !profile || followBusy || profile.is_me) return;
    setFollowBusy(true);
    try {
      const next = profile.is_following
        ? await api.unfollowUser(token, profile.user.id)
        : await api.followUser(token, profile.user.id);
      feedback.selected();
      setProfile((current) =>
        current
          ? {
              ...current,
              is_following: next.is_following,
              stats: {
                ...current.stats,
                followers: next.followers,
                following: next.following,
              },
            }
          : current,
      );
    } catch (err) {
      feedback.failed();
      await notifyUser(
        'Fehlgeschlagen',
        err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.',
      );
    } finally {
      setFollowBusy(false);
    }
  }

  /**
   * Story gesehen melden.
   *
   * Zweimal dasselbe, an zwei Orten: lokal, damit der Ring sofort ruhig wird, und
   * am Server, damit er es beim nächsten Laden auch bleibt. Der Aufruf darf still
   * scheitern – dann steht die Story später wieder als neu da, und das ist der
   * harmlosere von beiden Fehlern.
   */
  const onStorySeen = useCallback(
    (story: Story) => {
      setProfile((current) =>
        current
          ? {
              ...current,
              stories: (current.stories ?? []).map((item) =>
                item.id === story.id ? { ...item, seen: true } : item,
              ),
            }
          : current,
      );
      if (token) api.viewStory(token, story.id).catch(() => {});
    },
    [token],
  );

  /**
   * Eigene Story löschen.
   *
   * Erst schließen, dann löschen: Der Betrachter zeigt gerade genau dieses Bild.
   * Der Fehlerfall geht in eine Meldung und NICHT in `setError` – das würde die
   * ganze Seite gegen den Fehler-Zustand tauschen, obwohl das Profil steht.
   */
  const onStoryDelete = useCallback(
    async (story: Story) => {
      if (!token) return;
      const ok = await confirmAction(
        'Story löschen',
        'Die Story verschwindet sofort für alle.',
        'Löschen',
        true,
      );
      if (!ok) return;

      setStoryOpen(false);
      try {
        await api.deleteStory(token, story.id);
        setProfile((current) =>
          current
            ? { ...current, stories: (current.stories ?? []).filter((item) => item.id !== story.id) }
            : current,
        );
      } catch {
        await notifyUser('Fehlgeschlagen', 'Die Story ließ sich nicht löschen.');
      }
    },
    [token],
  );

  /** Ein geänderter Beitrag (Herz, Kommentarzahl, Text) wandert in die Liste. */
  const onPostChanged = useCallback((updated: ProfilePost) => {
    setProfile((current) =>
      current
        ? { ...current, posts: current.posts.map((p) => (p.id === updated.id ? updated : p)) }
        : current,
    );
  }, []);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        headerTransparent: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: surface.text,
        headerTitleStyle: { color: surface.text },
        title: profile?.user.name ?? 'Profil',
        headerBackTitle: 'Zurück',
      }}
    />
  );

  if (loading) {
    return (
      <HomeBackground style={styles.screen}>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={surface.accent} />
        </View>
      </HomeBackground>
    );
  }

  if (error || !profile) {
    return (
      <HomeBackground style={styles.screen}>
        {header}
        <View style={styles.centered}>
          <MascotError detail={error ?? 'Profil nicht gefunden.'} onRetry={load} />
          <ThemedText type="small" style={[styles.lockedText, { color: surface.textMuted }]}>
            Vielleicht wurde der Benutzername geändert.
          </ThemedText>
        </View>
      </HomeBackground>
    );
  }

  const links = sortLinks(profile.links);
  const tier = accountLabel(profile.user.account_type);

  /**
   * Zeigt diese Seite Beiträge und Links?
   *
   * Ältere Server schicken das Feld nicht mit – dann leiten wir es aus der Stufe
   * ab, mit derselben Regel wie der Server (`src/domain/account.ts`). So bleibt
   * eine neue App gegen ein altes Backend benutzbar.
   */
  // Beiträge sind gerade ausgeblendet (src/constants/features.ts) – dann zeigt
  // KEIN Profil sie, ganz gleich, was Stufe oder Server sagen.
  const showsPosts =
    Features.posts && (profile.shows_posts ?? accountAbilities(profile.user).hasPublicProfile);

  /** Das Bild hinter der Karte. Ältere Server kennen das Feld nicht. */
  const banner = profile.user.banner ?? null;

  return (
    <HomeBackground
      style={styles.screen}
      blurTarget={blurTarget}
      // Außerhalb des Blur-Ziels, damit das Blatt über allem liegt und sich
      // nicht selbst weichzeichnet.
      overlay={
        <AccountSheet
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          blurTarget={blurTarget}
        />
      }>
      {header}
      {/* Tastatur-Freistellung macht `KeyboardForm` (siehe dort). */}
      <View style={styles.flex}>
        <KeyboardForm
          contentContainerStyle={[
            styles.content,
            { paddingTop: headerHeight + Spacing.three, paddingBottom: insets.bottom + Spacing.six },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={surface.accent} />}>
          {/* Kopf: wer das ist und was für ein Konto */}
          <GlassCard tone="accent" radius={Radius.panel} style={styles.head}>
            {/* Der Banner. Er liegt IN der Karte und nicht als Streifen darüber:
                Gewählt wird ein Motiv, gezeigt wird seine Stimmung – deshalb
                weichgezeichnet und hinter allem. Über dem Bild liegen zwei
                Schleier: der milchige nimmt dem Foto den Kontrast, damit die
                Schrift lesbar bleibt, der blaue gibt der Karte ihre eigene
                Farbe zurück (ohne ihn wäre eine Karte mit Bild eine andere
                Karte als eine ohne). Die runden Ecken schneidet `GlassSurface`
                mit seinem `overflow: 'hidden'` ab. */}
            {banner ? (
              <View pointerEvents="none" style={styles.bannerLayer}>
                <BlurImage
                  source={{ uri: banner }}
                  style={[styles.bannerImage, { opacity: BANNER_OPACITY }]}
                  contentFit="cover"
                  blurRadius={BANNER_BLUR}
                  cachePolicy="memory-disk"
                  accessible={false}
                />
                {/* Nur noch EIN Schleier statt zweier. Der zweite (`chipBg`) gab
                    der Karte ihre blaue Tönung zurück – die kommt jetzt von der
                    Karte selbst, weil das Bild darunter durchsichtig ist. */}
                <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.fill }]} />
              </View>
            ) : null}

            <View style={styles.identity}>
              {/* Das Profilbild – und, wenn etwas läuft, der Ring darum.
                  Ein Tipp darauf öffnet die Storys dieser Person; das Profil ist
                  ja schon offen. Vorher lag hier ein Marken-Verlauf um JEDES
                  Bild: derselbe Ring wie in der Story-Leiste, nur ohne Bedeutung –
                  und damit ein Zeichen, das nichts mehr sagt. */}
              {Features.stories && storyGroups.length > 0 ? (
                <Pressable
                  onPress={() => {
                    feedback.tapped();
                    setStoryOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${stories.length === 1 ? 'Story' : `${stories.length} Storys`} von ${
                      profile.is_me ? 'dir' : profile.user.name
                    } ansehen` + (storyGroups[0].seen ? ', schon gesehen' : '')
                  }
                  hitSlop={6}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <StoryAvatar
                    size={AVATAR}
                    avatar={profile.user.avatar}
                    name={profile.user.name}
                    stories={stories.length}
                    seen={storyGroups[0].seen}
                  />
                </Pressable>
              ) : (
                <StoryAvatar
                  size={AVATAR}
                  avatar={profile.user.avatar}
                  name={profile.user.name}
                  stories={0}
                />
              )}

              <View style={styles.identityText}>
                <ThemedText style={[styles.name, { color: surface.text }]} numberOfLines={1}>
                  {profile.user.name}
                </ThemedText>
                {profile.user.username ? (
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                    @{profile.user.username}
                  </ThemedText>
                ) : null}
                {/* Die Plaketten liegen AUF der Akzent-Karte, also eine Stufe
                    kräftiger – mit `chipBg` hätten sie exakt die Farbe ihrer
                    Unterlage und wären nur noch Text ohne Pille. */}
                <View style={styles.badges}>
                  <ThemedText
                    type="small"
                    style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBgStrong }]}>
                    {tier.toUpperCase()}
                  </ThemedText>
                  {showsAdminBadge(profile) ? (
                    <ThemedText
                      type="small"
                      style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBgStrong }]}>
                      ADMIN
                    </ThemedText>
                  ) : null}
                </View>
              </View>

              {/* Eigenes Profil: der Stift öffnet die Bilder dieser Karte.
                  Hier stand ein Zahnrad, das ins Konto-Blatt führte – ein
                  Zeichen für „Einstellungen" an einem Knopf, der jetzt das
                  Aussehen der Karte ändert, hätte in die falsche Richtung
                  gezeigt. Konto, Admin-Bereich und Abmelden erreicht man
                  weiterhin von hier, als letzte Zeile im Editor. */}
              {profile.is_me ? (
                <Pressable
                  onPress={() => setEditOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel={editOpen ? 'Bearbeiten beenden' : 'Profil bearbeiten'}
                  accessibilityState={{ expanded: editOpen }}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.headButton,
                    { backgroundColor: surface.chipBgStrong },
                    pressed && styles.pressed,
                  ]}>
                  <Icon name={editOpen ? 'close' : 'edit'} size={17} color={surface.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {profile.user.created_at ? (
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Dabei seit {fmtMonth(profile.user.created_at)}
              </ThemedText>
            ) : null}

            {/* Follower und Gefolgt zuerst, in einer eigenen Zeile.
                Das sind die zwei Zahlen, wegen derer man auf ein fremdes Profil
                schaut – die drei darunter (Beiträge, veranstaltet, mitgemacht)
                beschreiben, WAS jemand tut, diese beiden, wen es interessiert.
                Deshalb stehen sie kräftiger und getrennt. */}
            {Features.follow ? (
            <View style={[styles.followRow, { borderColor: surface.chipBorder }]}>
              <Stat label="Follower" value={profile.stats.followers ?? 0} strong />
              <View style={[styles.followDivider, { backgroundColor: surface.chipBorder }]} />
              <Stat label="Folgt" value={profile.stats.following ?? 0} strong />
              {/* „Folgt dir" nur, wenn es stimmt – und nur auf fremden Profilen.
                  Es beantwortet die Frage, die man sich beim Folgen-Knopf
                  stellt: Kennt die Person mich überhaupt? */}
              {!profile.is_me && profile.follows_me ? (
                <ThemedText
                  type="small"
                  style={[
                    styles.followsYou,
                    { color: surface.chipText, backgroundColor: surface.chipBgStrong },
                  ]}>
                  Folgt dir
                </ThemedText>
              ) : null}
            </View>
            ) : null}

            <View style={styles.stats}>
              {/* Ohne Beiträge zählt die Beitragszahl nichts – dann steht dort
                  besser gar nichts als eine ehrliche 0, die nach „schreibt nie"
                  aussieht, obwohl die Stufe es gar nicht erlaubt. */}
              {showsPosts ? <Stat label="Beiträge" value={profile.stats.posts} /> : null}
              <Stat label="Veranstaltet" value={profile.stats.hosted} />
              <Stat label="Mitgemacht" value={profile.stats.joined} />
            </View>

            {/* Die Bilder dieser Karte – aufgeklappt, nicht als eigenes Blatt:
                Man sieht beim Ändern direkt, was sich ändert (das Bild links
                oben, der Hintergrund ringsum). Der Weg ins Konto steht als
                letzte Zeile mit, seit der Knopf oben rechts hierher führt. */}
            {profile.is_me && editOpen ? (
              <View style={[styles.imageEditor, { borderColor: surface.chipBorder }]}>
                <EditorRow
                  icon="user"
                  title="Profilbild"
                  hint={
                    profile.user.avatar
                      ? 'Rund, oben links auf dieser Karte'
                      : 'Ohne Bild stehen dort deine Initialen'
                  }
                  busy={imageBusy === 'avatar'}
                  locked={imageBusy !== null}
                  onPress={() => onChangeImage('avatar')}
                  onRemove={profile.user.avatar ? () => onRemoveImage('avatar') : undefined}
                />
                <EditorRow
                  icon="camera"
                  title="Banner"
                  hint={
                    banner
                      ? 'Liegt weichgezeichnet hinter dieser Karte'
                      : 'Ein Bild, das weichgezeichnet hinter dieser Karte liegt'
                  }
                  busy={imageBusy === 'banner'}
                  locked={imageBusy !== null}
                  onPress={() => onChangeImage('banner')}
                  onRemove={banner ? () => onRemoveImage('banner') : undefined}
                />

                {/* Nur am Gerät: Der Dateidialog des Browsers hat keinen
                    Zuschnitt (siehe {@link CROP}) – dort wäre der Satz ein
                    Versprechen, das die Oberfläche nicht hält. */}
                {Platform.OS !== 'web' ? (
                  <ThemedText
                    type="small"
                    style={[styles.editorMessage, { color: surface.textMuted }]}>
                    Nach dem Auswählen legst du den Ausschnitt fest.
                  </ThemedText>
                ) : null}

                {imageError ? (
                  <ThemedText type="small" style={[styles.error, styles.editorMessage]}>
                    {imageError}
                  </ThemedText>
                ) : null}

                <EditorRow
                  icon="gear"
                  title="Konto & Einstellungen"
                  hint="Fortschritt, Prämien, Admin-Bereich, Abmelden"
                  action="öffnen"
                  onPress={() => setAccountOpen(true)}
                />
              </View>
            ) : null}

            {/* Freundschaft. Nur auf fremden Profilen – und nur, wenn es einen
                nächsten Schritt gibt: Bei „befreundet" ist der Knopf ein
                Beenden-Knopf und darf deshalb nicht wie ein Angebot aussehen. */}
            {/* Folgen steht VOR der Freundschaft: Es ist der kleinere Schritt
                (einseitig, ohne Zustimmung) und damit der, den man zuerst tut.
                Beide nebeneinander, weil sie verschiedene Dinge sind – Folgen
                abonniert, Freundschaft öffnet Gruppen und Chats. */}
            {!profile.is_me ? (
              <View style={styles.relationRow}>
                {Features.follow ? (
                <View style={styles.relationButton}>
                  <BrandButton
                    title={
                      followBusy
                        ? 'Einen Moment …'
                        : profile.is_following
                          ? 'Gefolgt'
                          : 'Folgen'
                    }
                    variant={profile.is_following ? 'glass' : 'primary'}
                    loading={followBusy}
                    onPress={onFollowAction}
                  />
                </View>
                ) : null}
                <View style={styles.relationButton}>
                  <BrandButton
                    title={friendLabel(profile.friendship ?? 'none', friendBusy)}
                    variant="glass"
                    loading={friendBusy}
                    onPress={onFriendAction}
                  />
                </View>
              </View>
            ) : null}

            {/* Melden und Blockieren – klein, unter dem Freundschafts-Knopf.
                Sie gehören auf ein fremdes Profil, weil man hier landet, wenn
                jemand auffällig geworden ist. Bewusst zurückhaltend: Es sind
                Notausgänge, keine Angebote. */}
            {!profile.is_me ? (
              <View style={styles.safetyRow}>
                <Pressable
                  onPress={() => {
                    feedback.pressed();
                    setReporting(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${profile.user.name} melden`}
                  hitSlop={6}
                  style={styles.safetyLink}>
                  <Icon name="flag" size={14} color={surface.textMuted} />
                  <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                    Melden
                  </ThemedText>
                </Pressable>

                <Pressable
                  onPress={onBlock}
                  accessibilityRole="button"
                  accessibilityLabel={`${profile.user.name} blockieren`}
                  hitSlop={6}
                  style={styles.safetyLink}>
                  <Icon name="ban" size={14} color={surface.textMuted} />
                  <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                    Blockieren
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}
          </GlassCard>

          {/* Visitenkarte ohne Auftritt: Was fehlt, gehört gesagt – am eigenen
              Profil mit dem Weg dorthin, bei fremden als schlichte Einordnung. */}
          {!showsPosts && Features.accountTiers ? (
            <GlassCard tone="accent" radius={Radius.card} style={styles.empty}>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {profile.is_me
                  ? 'Beiträge und Social-Links gehören zum Creator-Konto. Damit bekommst du eine Seite, die andere ansehen können.'
                  : `${profile.user.name} hat ein Standard-Konto – Beiträge und Social-Links gibt es ab Creator.`}
              </ThemedText>
              {profile.is_me ? (
                <BrandButton title="Upgrade ansehen" onPress={() => router.push('/upgrade')} />
              ) : null}
            </GlassCard>
          ) : null}

          {/* Social-Links */}
          {showsPosts && Features.socialLinks && (links.length > 0 || profile.is_me) ? (
            <View style={styles.section}>
              <SectionHeader
                title="Social Media"
                action={
                  profile.is_me ? (
                    <Pressable
                      onPress={() => (linksOpen ? setLinksOpen(false) : openLinks(profile.links))}
                      accessibilityRole="button"
                      accessibilityLabel={linksOpen ? 'Bearbeiten beenden' : 'Social-Links bearbeiten'}
                      hitSlop={8}>
                      <ThemedText type="smallBold" style={{ color: surface.accent }}>
                        {linksOpen ? 'Schließen' : links.length > 0 ? 'Bearbeiten' : 'Hinzufügen'}
                      </ThemedText>
                    </Pressable>
                  ) : undefined
                }
              />

              {linksOpen ? (
                <GlassCard tone="accent" radius={Radius.card} style={styles.editor}>
                  {SOCIAL_PLATFORMS.map((platform) => (
                    <View key={platform.key} style={styles.editorRow}>
                      <SocialIcon platform={platform.key} size={20} color={surface.accent} />
                      <View style={styles.editorField}>
                        <ThemedText type="small" style={{ color: surface.textMuted }}>
                          {platform.label}
                        </ThemedText>
                        <TextField
                          value={drafts[platform.key] ?? ''}
                          onChangeText={(value) =>
                            setDrafts((current) => ({ ...current, [platform.key]: value }))
                          }
                          placeholder={platform.placeholder}
                          autoCapitalize="none"
                          autoCorrect={false}
                          maxLength={MAX_LINK_LENGTH}
                          fieldStyle={styles.linkField}
                          style={styles.linkInput}
                        />
                      </View>
                    </View>
                  ))}

                  {linkError ? (
                    <ThemedText type="small" style={styles.error}>
                      {linkError}
                    </ThemedText>
                  ) : null}

                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    Leer lassen entfernt den Eintrag.
                  </ThemedText>
                  <BrandButton
                    title={savingLinks ? 'Wird gespeichert …' : 'Links speichern'}
                    loading={savingLinks}
                    onPress={onSaveLinks}
                  />
                </GlassCard>
              ) : links.length > 0 ? (
                <View style={styles.linkList}>
                  {links.map((link) => {
                    const info = platformInfo(link.platform);
                    return (
                      <GlassChip
                        key={link.platform}
                        icon={<SocialIcon platform={link.platform} size={15} color={surface.chipText} />}
                        label={displaySocialLink(link.platform, link.url)}
                        selected
                        onPress={() => openLink(link.url)}
                        accessibilityLabel={`${info?.label ?? link.platform} öffnen`}
                      />
                    );
                  })}
                </View>
              ) : (
                <GlassCard tone="accent" radius={Radius.card} style={styles.empty}>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    Noch keine Links. Zeig den Leuten, wo sie dir folgen können.
                  </ThemedText>
                </GlassCard>
              )}
            </View>
          ) : null}

          {/* Beitrag verfassen – nur am eigenen Profil und nur mit der Stufe */}
          {profile.is_me && showsPosts ? (
            <View style={styles.section}>
              <SectionHeader title="Neuer Beitrag" />
              <GlassCard tone="accent" radius={Radius.card} style={styles.composer}>
                <TextField
                  value={body}
                  onChangeText={setBody}
                  placeholder="Was gibt es Neues?"
                  multiline
                  maxLength={MAX_BODY}
                  fieldStyle={styles.composerField}
                  style={styles.composerInput}
                />

                {image ? (
                  <View style={styles.previewWrap}>
                    <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="cover" />
                    <Pressable onPress={() => setImage(null)} style={styles.previewRemove}>
                      <ThemedText type="smallBold" style={{ color: '#ef4444' }}>
                        Bild entfernen
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : null}

                {postError ? (
                  <ThemedText type="small" style={styles.error}>
                    {postError}
                  </ThemedText>
                ) : null}

                <View style={styles.composerBar}>
                  <Pressable
                    onPress={chooseImage}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.photoButton,
                      // Eine Stufe kräftiger als die Karte: auf der blauen Fläche
                      // löste sich der Knopf in derselben Tönung auf.
                      { backgroundColor: surface.chipBgStrong },
                      pressed && styles.pressed,
                    ]}>
                    <Icon name="camera" size={15} color={surface.text} />
                    <ThemedText type="small" style={{ color: surface.text }}>
                      Foto
                    </ThemedText>
                  </Pressable>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {body.length}/{MAX_BODY}
                  </ThemedText>
                </View>

                <BrandButton
                  title={posting ? 'Wird veröffentlicht …' : 'Veröffentlichen'}
                  loading={posting}
                  onPress={onPublish}
                />
              </GlassCard>
            </View>
          ) : null}

          {/* Beiträge */}
          {showsPosts ? (
          <View style={styles.section}>
            <SectionHeader title="Beiträge" />
            {profile.posts.length === 0 ? (
              <GlassCard tone="accent" radius={Radius.card} style={styles.empty}>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  {profile.is_me
                    ? 'Noch nichts geschrieben. Dein erster Beitrag steht gleich hier.'
                    : 'Hier ist noch nichts – dieses Konto hat noch nichts geschrieben.'}
                </ThemedText>
              </GlassCard>
            ) : (
              profile.posts.map((post) => (
                <ProfilePostCard
                  key={post.id}
                  post={post}
                  isMine={profile.is_me}
                  onChanged={onPostChanged}
                  onDelete={onDeletePost}
                />
              ))
            )}
          </View>
          ) : null}
        </KeyboardForm>
      </View>

      {/* Der Story-Betrachter: ein eigenes Fenster (`Modal`), deshalb hier unten
          und nicht am Profilbild, das ihn öffnet. */}
      <StoryViewer
        groups={storyGroups}
        startGroup={storyOpen && storyGroups.length > 0 ? 0 : null}
        onClose={() => setStoryOpen(false)}
        onSeen={onStorySeen}
        // Der Papierkorb erscheint nur an eigenen Storys – das prüft der
        // Betrachter selbst über `story.is_mine`.
        onDelete={onStoryDelete}
      />

      {/* Melden. `type: 'user'` – gemeldet wird das Konto, nicht ein einzelner
          Beitrag darauf; für den gibt es den Weg am Beitrag selbst. */}
      <ReportSheet
        target={
          reporting && profile
            ? {
                type: 'user',
                id: profile.user.id,
                label: profile.user.username ? `@${profile.user.username}` : profile.user.name,
              }
            : null
        }
        onClose={() => setReporting(false)}
      />
    </HomeBackground>
  );
}

/**
 * Beschriftung des Freundschafts-Knopfes.
 *
 * Vier Zustände, vier Wörter – und jedes sagt, was der TIPP tut, nicht was
 * gerade ist. „Befreundet" wäre eine Statusmeldung auf einem Knopf, der beendet.
 *
 * Bewusst kurz: Der Knopf teilt sich die Zeile mit „Folgen", und
 * „Freundschaft beenden" hätte dort umgebrochen. Was genau passiert, sagt
 * ohnehin erst die Rückfrage danach.
 */
function friendLabel(state: NonNullable<PublicProfile['friendship']>, busy: boolean): string {
  if (busy) return 'Moment …';
  switch (state) {
    case 'friends':
      return 'Befreundet ✓';
    case 'incoming':
      return 'Annehmen';
    case 'outgoing':
      return 'Angefragt';
    default:
      return 'Befreunden';
  }
}

/**
 * Eine Zahl mit Beschriftung.
 *
 * `strong` ist für Follower und Gefolgt: Sie stehen weiter oben und sollen als
 * Erstes ins Auge fallen – die drei Zahlen darunter beschreiben, was jemand tut,
 * diese beiden, wen es interessiert.
 */
function Stat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  const surface = useBrandSurface();
  return (
    <View style={styles.stat}>
      <ThemedText
        style={[styles.statValue, strong && styles.statValueStrong, { color: surface.text }]}>
        {value}
      </ThemedText>
      <ThemedText type="small" style={{ color: surface.textMuted }}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Eine Zeile im Editor: Symbol, Titel, Einordnung – und rechts ein Papierkorb,
 * sobald es überhaupt ein Bild zum Abnehmen gibt.
 *
 * `locked` sperrt ALLE Zeilen, während ein Bild unterwegs ist, `busy` sagt
 * zusätzlich, welche gerade dran ist. Beides ist nötig: Zwei gleichzeitige
 * Uploads schicken zwei Antworten mit dem Konto, und die zweite überschriebe
 * das Ergebnis der ersten.
 *
 * `action` ist das Verb für den Screenreader. Standard ist „ändern", weil das
 * hier meistens stimmt – die Zeile ins Konto-Blatt öffnet aber, sie ändert nicht.
 */
function EditorRow({
  icon,
  title,
  hint,
  action = 'ändern',
  busy = false,
  locked = false,
  onPress,
  onRemove,
}: {
  icon: UiIconName;
  title: string;
  hint: string;
  action?: string;
  busy?: boolean;
  locked?: boolean;
  onPress: () => void;
  onRemove?: () => void;
}) {
  const surface = useBrandSurface();

  return (
    <View style={styles.imageRow}>
      <Pressable
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={`${title} ${action}`}
        accessibilityState={{ disabled: locked, busy }}
        style={({ pressed }) => [
          styles.imageRowMain,
          pressed && styles.pressed,
          locked && !busy && styles.dimmed,
        ]}>
        {/* Der Dreher sitzt IM Symbolplatz, nicht daneben: So bleibt die Zeile
            gleich hoch und nichts rutscht, während das Bild hochgeht. */}
        <View style={styles.imageRowIcon}>
          {busy ? (
            <ActivityIndicator size="small" color={surface.accent} />
          ) : (
            <Icon name={icon} size={20} color={surface.accent} />
          )}
        </View>
        <View style={styles.imageRowText}>
          <ThemedText style={[styles.imageRowTitle, { color: surface.text }]}>{title}</ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={2}>
            {hint}
          </ThemedText>
        </View>
        <Icon name="chevron-right" size={18} color={surface.textMuted} />
      </Pressable>

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          disabled={locked}
          accessibilityRole="button"
          accessibilityLabel={`${title} entfernen`}
          hitSlop={10}
          style={({ pressed }) => [
            styles.imageRowRemove,
            pressed && styles.pressed,
            locked && styles.dimmed,
          ]}>
          <Icon name="trash" size={16} color={surface.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  /** Melden und Blockieren: Notausgänge, keine Angebote – deshalb schlicht. */
  safetyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.five,
    marginTop: Spacing.two,
  },
  safetyLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  content: {
    paddingHorizontal: Spacing.four,
    // `paddingTop` kommt aus der Höhe der durchsichtigen Kopfzeile (siehe dort).
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.six,
  },
  lockedText: { textAlign: 'center' },

  head: { gap: Spacing.three, padding: Spacing.four },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  // Profilbild, Ring und Initialen wohnen jetzt in `components/story-avatar.tsx` –
  // derselbe Ring trägt in der Story-Leiste und in den Personenzeilen dieselbe
  // Aussage, und die soll er nicht an drei Stellen nachgebaut bekommen.
  identityText: { flex: 1, gap: 3 },
  name: { fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -0.4 },
  badges: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap', marginTop: 2 },
  badge: {
    fontWeight: '800',
    letterSpacing: 1.1,
    fontSize: 10,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  headButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Der Banner liegt unter allem, deshalb `zIndex: 0` – die Geschwister der
  // Karte stehen ohne eigenen Wert darüber. `overflow: 'hidden'` schneidet den
  // Überhang ab, den `bannerImage` bewusst hat.
  bannerLayer: { ...StyleSheet.absoluteFill, zIndex: 0, overflow: 'hidden' },
  bannerImage: {
    position: 'absolute',
    top: -BANNER_BLEED,
    right: -BANNER_BLEED,
    bottom: -BANNER_BLEED,
    left: -BANNER_BLEED,
  },

  /** Follower und Gefolgt – eigene, abgesetzte Zeile über den drei Zahlen. */
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: Spacing.three,
  },
  followDivider: { width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch' },
  followsYou: {
    fontWeight: '700',
    fontSize: 11,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  /** Folgen und Befreunden teilen sich die Breite. */
  relationRow: { flexDirection: 'row', gap: Spacing.two },
  relationButton: { flex: 1 },

  stats: { flexDirection: 'row', gap: Spacing.four },
  stat: { flex: 1, gap: 1 },
  statValue: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  statValueStrong: { fontSize: 24, lineHeight: 30 },

  section: { gap: Spacing.two },
  empty: { padding: Spacing.four },

  // Bild-Editor: ein abgesetzter Block IN der Karte, kein zweites Kästchen
  // darauf. Nur eine Linie oben trennt ihn von den Zahlen darüber.
  imageEditor: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: Spacing.one,
    marginTop: Spacing.one,
  },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  imageRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  // Feste Breite wie in `setting-row.tsx`: So fluchten die Titel, egal ob dort
  // ein Symbol oder der Dreher steht.
  imageRowIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  imageRowText: { flex: 1, gap: 1 },
  imageRowTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  imageRowRemove: { padding: Spacing.two },
  editorMessage: { paddingBottom: Spacing.two },
  /** Gesperrt, aber nicht dran: sichtbar zurückgenommen statt unsichtbar. */
  dimmed: { opacity: 0.45 },

  linkList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },

  editor: { gap: Spacing.three, padding: Spacing.four },
  editorRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three },
  editorField: { flex: 1, gap: 2 },
  // Kompakte Zeile: `minHeight: 0` hebt die 56 px des Standardfeldes auf, der
  // Rest (Farbe, Fokus-/Fehlerrand, Schrift) kommt aus `TextField`.
  linkField: {
    minHeight: 0,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
  },
  linkInput: {
    paddingVertical: Spacing.two,
    fontSize: 15,
  },

  composer: { gap: Spacing.three, padding: Spacing.four },
  composerField: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
  },
  composerInput: {
    fontSize: 15,
    lineHeight: 21,
  },
  composerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  previewWrap: { gap: Spacing.two },
  preview: { width: '100%', height: 170, borderRadius: Radius.card },
  previewRemove: { alignSelf: 'flex-start' },

  // Die Beitrags-Optik wohnt jetzt in `components/profile-post-card.tsx` – der
  // Beitrag trägt Herz, Kommentare und einen Editor und ist damit eine eigene
  // Komponente statt ein Block in diesem Screen.

  error: { color: '#ef4444' },
});

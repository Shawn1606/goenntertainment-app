/**
 * Ein Beitrag auf der Profilseite – mit Gefällt-mir, Kommentaren und (für die
 * Verfasser:in) einer nachträglich änderbaren Beschreibung.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Ein Beitrag trägt jetzt vier Zustände, die nichts miteinander zu tun haben:
 * das Herz, die aufgeklappten Kommentare, das Kommentarfeld und der Editor für
 * die Beschreibung. Lägen die in `profile/[username].tsx`, hätte dieser Screen
 * vier Zustände MAL Anzahl der Beiträge – man müsste sie über IDs auseinander-
 * halten. Als eigene Komponente hat jeder Beitrag seine eigenen, und das
 * Aufklappen eines Kommentarbereichs rendert nicht die ganze Seite neu.
 *
 * ## Die Zahlen kommen vom Server, nicht aus eigener Rechnung
 *
 * Jede Antwort auf Liken/Kommentieren/Löschen bringt den vollständigen Beitrag
 * mit neuen Zählern mit. Die App zählt deshalb NICHT selbst hoch: Zwei schnelle
 * Tipps hintereinander liefen sonst auseinander, und der Stand nach dem
 * Neuladen wäre ein anderer als der auf dem Bildschirm.
 *
 * Was die App vorwegnimmt, ist allein das Herz selbst (gefüllt/leer) – dieser
 * eine Zustand muss sich sofort anfühlen, und wenn der Aufruf scheitert,
 * springt er zurück.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { BrandButton } from '@/components/ui/brand-button';
import { GlassCard } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { HeartFilledIcon, HeartIcon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { commentGoneAfterDeleteError } from '@/domain/activity-social';
import { formatRelativeShort } from '@/domain/date-format';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, api, type PostComment, type ProfilePost } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';

/** Länge eines Kommentars – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_COMMENT = 500;
/** Länge eines Beitrags – dieselbe Zahl wie in profile/[username].tsx. */
const MAX_BODY = 1000;

export type ProfilePostCardProps = {
  post: ProfilePost;
  /** true = eigenes Profil; schaltet Bearbeiten und Löschen frei. */
  isMine: boolean;
  /** Der Beitrag hat sich geändert (Herz, Kommentarzahl, Text). */
  onChanged: (post: ProfilePost) => void;
  onDelete: (post: ProfilePost) => void;
};

export function ProfilePostCard({ post, isMine, onChanged, onDelete }: ProfilePostCardProps) {
  const surface = useBrandSurface();
  const { token, user } = useAuth();

  /** Herz-Zustand vorweggenommen, damit der Tipp sofort wirkt (siehe Kopf). */
  const [liking, setLiking] = useState(false);
  /** Kommentare aufgeklappt? `null` = noch nie geladen. */
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** Editor für die Beschreibung – `null` = zu. */
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The comment the report sheet is open for (F-08); null = closed. */
  const [reporting, setReporting] = useState<PostComment | null>(null);

  const liked = Boolean(post.liked_by_me);
  const likes = post.likes_count ?? 0;
  const commentCount = post.comments_count ?? 0;

  const loadComments = useCallback(async () => {
    if (!token) return;
    setLoadingComments(true);
    setError(null);
    try {
      const res = await api.postComments(token, post.id);
      setComments(res.data);
    } catch {
      setError('Die Kommentare ließen sich nicht laden.');
    } finally {
      setLoadingComments(false);
    }
  }, [token, post.id]);

  /** Auf-/zuklappen. Geladen wird erst beim ersten Öffnen. */
  async function toggleComments() {
    feedback.tapped();
    const next = !open;
    setOpen(next);
    if (next && comments === null) await loadComments();
  }

  async function toggleLike() {
    if (!token || liking) return;
    setLiking(true);
    setError(null);
    // Sofort umschalten – der Server liefert gleich die richtigen Zahlen nach.
    onChanged({
      ...post,
      liked_by_me: !liked,
      likes_count: Math.max(0, likes + (liked ? -1 : 1)),
    });
    try {
      const res = liked
        ? await api.unlikePost(token, post.id)
        : await api.likePost(token, post.id);
      onChanged(res.data);
      feedback.selected();
    } catch (err) {
      // Zurücknehmen: Der Bildschirm darf nicht behaupten, was der Server nicht hat.
      onChanged(post);
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.');
    } finally {
      setLiking(false);
    }
  }

  async function onSendComment() {
    if (!token || sending) return;
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setError(null);
    // Wie im Chat: Feld sofort leeren, bei einem Fehler den Text zurückgeben.
    setDraft('');
    try {
      const res = await api.addComment(token, post.id, text);
      setComments((current) => [...(current ?? []), res.data]);
      onChanged(res.post);
      feedback.tapped();
    } catch (err) {
      setDraft(text);
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Der Kommentar ging nicht raus.');
    } finally {
      setSending(false);
    }
  }

  async function onDeleteComment(comment: PostComment) {
    if (!token) return;
    const ok = await confirmAction('Kommentar löschen', 'Er verschwindet für alle.', 'Löschen', true);
    if (!ok) return;
    try {
      const res = await api.deleteComment(token, comment.id);
      setComments((current) => (current ?? []).filter((row) => row.id !== comment.id));
      onChanged(res.data);
      feedback.left();
    } catch (err) {
      // 404: the comment is gone - deleted earlier, or deleted now while the post is hidden by a
      // block (F-13). It leaves the list; there is nothing to report.
      if (err instanceof ApiError && commentGoneAfterDeleteError(err.status)) {
        setComments((current) => (current ?? []).filter((row) => row.id !== comment.id));
        return;
      }
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Löschen hat nicht geklappt.');
    }
  }

  async function onSaveDescription() {
    if (!token || editing === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updatePost(token, post.id, editing.trim());
      onChanged(res.data);
      setEditing(null);
      feedback.tapped();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Speichern hat nicht geklappt.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard tone="accent" radius={Radius.card} style={styles.post}>
      <View style={styles.head}>
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          {formatRelativeShort(post.created_at, new Date())}
          {/* „bearbeitet" gehört sichtbar dazu: Ein Beitrag, unter dem schon
              kommentiert wurde, darf sich nicht unbemerkt ändern. */}
          {post.edited ? ' · bearbeitet' : ''}
        </ThemedText>

        {isMine ? (
          <View style={styles.ownerActions}>
            <Pressable
              onPress={() => setEditing(editing === null ? post.body : null)}
              accessibilityRole="button"
              accessibilityLabel={
                editing === null ? 'Beschreibung bearbeiten' : 'Bearbeiten beenden'
              }
              accessibilityState={{ expanded: editing !== null }}
              hitSlop={8}>
              <Icon name={editing === null ? 'edit' : 'close'} size={16} color={surface.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => onDelete(post)}
              accessibilityRole="button"
              accessibilityLabel="Beitrag löschen"
              hitSlop={8}>
              <Icon name="trash" size={16} color="#ef4444" />
            </Pressable>
          </View>
        ) : null}
      </View>

      {editing !== null ? (
        <View style={styles.editor}>
          <TextField
            value={editing}
            onChangeText={setEditing}
            placeholder="Beschreibung"
            multiline
            maxLength={MAX_BODY}
            fieldStyle={styles.field}
            style={styles.fieldText}
          />
          <BrandButton
            title={saving ? 'Wird gespeichert …' : 'Beschreibung speichern'}
            loading={saving}
            onPress={onSaveDescription}
          />
        </View>
      ) : post.body ? (
        <ThemedText style={{ color: surface.text }}>{post.body}</ThemedText>
      ) : isMine ? (
        // Ein Bild ohne Text: der Anlass, warum es das Bearbeiten überhaupt gibt.
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          Noch keine Beschreibung – tippe oben auf den Stift.
        </ThemedText>
      ) : null}

      {post.image_url ? (
        <Image source={{ uri: post.image_url }} style={styles.image} resizeMode="cover" />
      ) : null}

      {/* Herz und Kommentare. Immer beide sichtbar, auch bei 0 – eine Leiste,
          die je nach Zahl anders aussieht, springt beim ersten Like. */}
      <View style={[styles.bar, { borderTopColor: surface.chipBorder }]}>
        <Pressable
          onPress={toggleLike}
          disabled={liking}
          accessibilityRole="button"
          accessibilityState={{ selected: liked }}
          accessibilityLabel={
            liked ? `Gefällt mir zurücknehmen, ${likes}` : `Gefällt mir, ${likes}`
          }
          hitSlop={6}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          {liked ? (
            <HeartFilledIcon size={18} color={surface.accent} />
          ) : (
            <HeartIcon size={18} color={surface.textMuted} />
          )}
          <ThemedText
            type="smallBold"
            style={{ color: liked ? surface.accent : surface.textMuted }}>
            {likes}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={toggleComments}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          accessibilityLabel={`Kommentare, ${commentCount}`}
          hitSlop={6}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Icon name="chat" size={18} color={open ? surface.accent : surface.textMuted} />
          <ThemedText
            type="smallBold"
            style={{ color: open ? surface.accent : surface.textMuted }}>
            {commentCount}
          </ThemedText>
        </Pressable>
      </View>

      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      {open ? (
        <View style={styles.comments}>
          {loadingComments ? (
            <ActivityIndicator color={surface.accent} />
          ) : (comments ?? []).length === 0 ? (
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Noch keine Kommentare. Schreib den ersten.
            </ThemedText>
          ) : (
            (comments ?? []).map((comment) => (
              <View key={comment.id} style={styles.comment}>
                <View style={styles.commentHead}>
                  <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                    {comment.user.name}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {formatRelativeShort(comment.created_at, new Date())}
                  </ThemedText>
                  {comment.user.id !== user?.id ? (
                    <Pressable
                      onPress={() => setReporting(comment)}
                      accessibilityRole="button"
                      accessibilityLabel="Kommentar melden"
                      hitSlop={8}>
                      <Icon name="flag" size={14} color={surface.textMuted} />
                    </Pressable>
                  ) : null}
                  {comment.can_delete ? (
                    <Pressable
                      onPress={() => onDeleteComment(comment)}
                      accessibilityRole="button"
                      accessibilityLabel={`Kommentar von ${comment.user.name} löschen`}
                      hitSlop={8}>
                      <Icon name="trash" size={14} color={surface.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
                <ThemedText type="small" style={{ color: surface.text }}>
                  {comment.body}
                </ThemedText>
              </View>
            ))
          )}

          <View style={styles.composer}>
            <TextField
              value={draft}
              onChangeText={setDraft}
              placeholder="Kommentar schreiben"
              multiline
              maxLength={MAX_COMMENT}
              editable={!sending}
              fieldStyle={styles.field}
              style={styles.fieldText}
            />
            <Pressable
              onPress={onSendComment}
              disabled={sending || draft.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Kommentar senden"
              hitSlop={8}
              style={({ pressed }) => [
                styles.send,
                {
                  backgroundColor: draft.trim() ? surface.accent : surface.chipBg,
                },
                pressed && styles.pressed,
              ]}>
              {sending ? (
                <ActivityIndicator size="small" color={surface.accentText} />
              ) : (
                <Icon
                  name="send"
                  size={16}
                  color={draft.trim() ? surface.accentText : surface.textMuted}
                />
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* The card lives on a route screen, not inside a modal, so the sheet can sit here. */}
      <ReportSheet
        target={reporting ? { type: 'post_comment', id: reporting.id, label: reporting.body } : null}
        onClose={() => setReporting(null)}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  post: { gap: Spacing.two, padding: Spacing.four },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ownerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  image: { width: '100%', height: 200, borderRadius: Radius.card, marginTop: Spacing.one },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.five,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: Spacing.two,
    marginTop: Spacing.one,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  pressed: { opacity: 0.6 },
  comments: { gap: Spacing.three, paddingTop: Spacing.one },
  comment: { gap: 2 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  editor: { gap: Spacing.two },
  // Kompakte Zeile: `minHeight: 0` hebt die 56 px des Standardfeldes auf, der
  // Rest (Farbe, Fokus-/Fehlerrand, Schrift) kommt aus `TextField`.
  field: {
    flex: 1,
    minHeight: 0,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
  },
  fieldText: { paddingVertical: Spacing.two, fontSize: 15, lineHeight: 21 },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: '#ef4444', fontFamily: FontFamily.regular },
});

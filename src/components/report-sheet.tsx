/**
 * Melde-Blatt: Grund wählen, optional etwas dazu schreiben, abschicken.
 *
 * ## Ein Blatt für alles, was gemeldet werden kann
 *
 * Chat-Nachrichten, Konten, Gruppen, Partner, Angebote. Die Handlung ist überall
 * dieselbe, also ist es überall dasselbe Blatt – der Aufrufer sagt nur, **was**
 * gemeldet wird (`targetType`, `targetId`) und wie es heißt (`targetLabel`).
 *
 * ## Warum hier steht, was eine Meldung NICHT tut
 *
 * Der Satz unten („wir sehen uns das an, sofort ruhig ist es mit Blockieren") ist
 * kein Kleingedrucktes. Ohne ihn erwarten Leute, dass nach dem Absenden etwas
 * verschwindet – und wenn nichts verschwindet, melden sie nie wieder. Der Hinweis
 * auf das Blockieren steht direkt daneben, weil das die Handlung ist, die sofort
 * wirkt.
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { useSheetDrag } from '@/components/ui/use-sheet-drag';
import { Radius, Spacing } from '@/constants/theme';
import { REPORT_REASONS, isUrgent } from '@/domain/report-reason';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, api, type ReportTarget } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';

/** Länge der freien Schilderung; gleiche Zahl wie `MAX_REPORT_NOTE` im Server. */
const MAX_NOTE = 500;

/** Was unter dem Blatt steht, wenn die Meldung nicht rausging. */
function reportError(err: unknown): string {
  return err instanceof ApiError ? err.firstError() : 'Die Meldung ging nicht raus.';
}

type Props = {
  /** `null` schließt das Blatt. */
  target: { type: ReportTarget; id: number; label: string } | null;
  onClose: () => void;
  /**
   * Wird nach einer erfolgreichen Meldung aufgerufen – z. B. um zusätzlich das
   * Blockieren anzubieten. Optional: Bei einem Angebot gibt es niemanden zu
   * blockieren.
   */
  onReported?: () => void;
};

export function ReportSheet({ target, onClose, onReported }: Props) {
  const surface = useBrandSurface();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = target !== null;

  function reset() {
    setReason(null);
    setNote('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  // Nach unten wischen schließt – wie jedes Blatt der App (use-sheet-drag.ts).
  const drag = useSheetDrag({ onDismiss: close, open: visible });

  async function submit() {
    if (!token || !target || !reason || sending) return;
    setSending(true);
    setError(null);
    // Alle Entscheidungen vor dem `try`: Bedingungen darin kann der React Compiler
    // nicht übersetzen – dann bliebe das ganze Blatt unoptimiert.
    const thanks = isUrgent(reason)
      ? 'Wir sehen uns das sofort an. Wenn jemand in unmittelbarer Gefahr ist, ruf bitte zusätzlich den Notruf 112.'
      : 'Wir sehen uns das an. Du erfährst nichts über das Ergebnis – das schützt beide Seiten.';
    const afterReport = onReported ?? (() => {});
    try {
      await api.report(token, {
        targetType: target.type,
        targetId: target.id,
        reason,
        note,
      });
      feedback.selected();
      reset();
      onClose();
      await notifyUser('Danke für den Hinweis', thanks);
      afterReport();
    } catch (err) {
      feedback.failed();
      setError(reportError(err));
    }
    setSending(false);
  }

  if (!target) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* Eigene Gesten-Wurzel: Ein Modal liegt auf Android außerhalb der App-Wurzel. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, drag.backdropStyle]}>
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Schließen" />
        </Animated.View>

        <Animated.View style={[styles.sheetFrame, drag.sheetStyle]} onLayout={drag.onSheetLayout}>
          <GlassSurface tone="panel" radius={Radius.panel} style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
            <GestureDetector gesture={drag.headGesture}>
              <View>
                <View style={styles.handleZone}>
                  <View style={[styles.handle, { backgroundColor: surface.cardBorder }]} />
                </View>
                <View style={styles.header}>
                  <ThemedText type="subtitle" style={{ color: surface.text }}>
                    Melden
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={2}>
                    {target.label}
                  </ThemedText>
                </View>
              </View>
            </GestureDetector>

            <GestureDetector gesture={drag.listGesture}>
              <View style={styles.listFrame}>
                <GestureDetector gesture={drag.scrollGesture}>
                  <Animated.ScrollView
                    style={styles.listFrame}
                    onScroll={drag.onScroll}
                    scrollEventThrottle={16}
                    bounces={false}
                    overScrollMode="never"
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled">
                    <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                      Was ist das Problem?
                    </ThemedText>

                    {REPORT_REASONS.map((option) => {
                      const selected = reason === option.key;
                      return (
                        <Pressable
                          key={option.key}
                          onPress={() => {
                            feedback.selected();
                            setReason(option.key);
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          style={({ pressed }) => [
                            styles.option,
                            {
                              borderColor: selected ? surface.accent : surface.chipBorder,
                              backgroundColor: selected ? surface.chipBgStrong : surface.chipBg,
                            },
                            pressed && styles.pressed,
                          ]}>
                          <Icon name={option.icon} size={20} color={selected ? surface.accent : surface.textMuted} />
                          <View style={styles.optionText}>
                            <ThemedText type="smallBold" style={{ color: surface.text }}>
                              {option.label}
                            </ThemedText>
                            <ThemedText type="small" style={{ color: surface.textMuted }}>
                              {option.hint}
                            </ThemedText>
                          </View>
                          {selected ? <Icon name="check" size={18} color={surface.accent} /> : null}
                        </Pressable>
                      );
                    })}

                    {/* Die Schilderung erscheint erst nach der Wahl des Grundes: Ein
                        leeres Textfeld über acht Optionen sieht aus, als müsste man
                        schreiben, bevor man wählen darf. */}
                    {reason ? (
                      <View style={styles.noteWrap}>
                        <TextField
                          label="Was ist passiert? (freiwillig)"
                          value={note}
                          onChangeText={setNote}
                          placeholder="Kurz in eigenen Worten"
                          multiline
                          numberOfLines={3}
                          maxLength={MAX_NOTE}
                          editable={!sending}
                        />
                        <ThemedText type="small" style={{ color: surface.textMuted }}>
                          Eine Meldung entfernt nichts sofort – wir sehen uns das an. Wenn du sofort Ruhe willst, blockiere das
                          Konto.
                        </ThemedText>
                      </View>
                    ) : null}

                    {error ? (
                      <ThemedText type="small" style={styles.errorText}>
                        {error}
                      </ThemedText>
                    ) : null}
                  </Animated.ScrollView>
                </GestureDetector>
              </View>
            </GestureDetector>

            <View style={styles.actions}>
              <PressableScale
                onPress={close}
                disabled={sending}
                haptic="none"
                scaleTo={0.97}
                style={[styles.secondaryButton, { borderColor: surface.cardBorder }]}>
                <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                  Abbrechen
                </ThemedText>
              </PressableScale>

              <PressableScale
                onPress={submit}
                disabled={sending || !reason}
                haptic="none"
                scaleTo={0.97}
                style={[styles.primaryButton, { backgroundColor: reason ? surface.accent : surface.chipBg }]}>
                {sending ? (
                  <ActivityIndicator color={surface.accentText} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: reason ? surface.accentText : surface.textMuted }}>
                    Meldung senden
                  </ThemedText>
                )}
              </PressableScale>
            </View>
          </GlassSurface>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  /** Trägt Höhe und Bewegung; das Glas darin schrumpft mit, damit die Liste scrollt. */
  sheetFrame: { maxHeight: '88%' },
  sheet: {
    borderTopLeftRadius: Radius.panel,
    borderTopRightRadius: Radius.panel,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    flexShrink: 1,
  },
  listFrame: { flexShrink: 1, minHeight: 0 },
  handleZone: { paddingBottom: Spacing.three, alignItems: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { gap: 2, marginBottom: Spacing.three },
  list: { gap: Spacing.two, paddingBottom: Spacing.three },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  optionText: { flex: 1, gap: 1 },
  noteWrap: { gap: Spacing.two, marginTop: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.three, paddingTop: Spacing.three },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButton: {
    flex: 2,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { color: '#ef4444' },
  pressed: { opacity: 0.7 },
});

/**
 * Listen im Kartenstil – für Konto, Einstellungen und Gruppen.
 *
 * Ein Abschnitt hat eine kleine Überschrift über einer Karte; darin Zeilen mit
 * runder Symbolfläche, Titel, optionalem Hinweis und rechts entweder einem Wert
 * mit Pfeil (führt weiter) oder einem Schalter. Alle Zeilen sind mindestens 56 px
 * hoch – gut zu treffen, und nichts überlappt, auch wenn der Hinweis zweizeilig
 * wird.
 *
 * Bewusst EIN Baustein für alle Listen: Wenn Konto und Einstellungen gleich
 * aussehen, findet man sich sofort zurecht.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import * as feedback from '@/lib/feedback';

const DANGER = '#e11d48';

/** Überschrift + Karte. Die Zeilen darin trennt `ListRow` selbst (`first`). */
export function ListSection({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
      ) : null}
      <Card padded={false}>{children}</Card>
      {footer ? <Text style={[styles.footer, { color: colors.textSecondary }]}>{footer}</Text> : null}
    </View>
  );
}

type RowBase = {
  icon: UiIconName;
  title: string;
  hint?: string;
  /** Erste Zeile der Karte: ohne Trennlinie oben. */
  first?: boolean;
  danger?: boolean;
};

/** Zeile, die weiterführt (Pfeil) – oder nur informiert, wenn `onPress` fehlt. */
export function ListRow({
  icon,
  title,
  hint,
  value,
  badge,
  first = false,
  danger = false,
  onPress,
  right,
}: RowBase & {
  /** Rechts vor dem Pfeil, z. B. „Gold Plan" oder „An". */
  value?: string;
  /** Kleine Zahl im Akzent (Ungelesenes, Offenes). */
  badge?: number;
  onPress?: () => void;
  /** Eigener Inhalt rechts statt Wert und Pfeil. */
  right?: ReactNode;
}) {
  const colors = useTheme();
  const tint = danger ? DANGER : colors.tint;
  const content = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: danger ? 'rgba(225,29,72,0.1)' : colors.backgroundSelected }]}>
        <Icon name={icon} size={19} color={tint} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: danger ? DANGER : colors.text }]}>{title}</Text>
        {hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text> : null}
      </View>
      {right ?? (
        <>
          {value ? (
            <Text style={[styles.value, { color: colors.textSecondary }]} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {badge ? (
            <View style={[styles.badge, { backgroundColor: colors.tint }]}>
              <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          ) : null}
          {onPress ? <Icon name="chevron-right" size={18} color={colors.textSecondary} /> : null}
        </>
      )}
    </>
  );

  const rowStyle = [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border }];

  if (!onPress) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={[title, hint, value].filter(Boolean).join(', ')}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress} haptic="tap" scaleTo={0.99} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} style={rowStyle}>
      {content}
    </PressableScale>
  );
}

/**
 * Zeile mit Schalter. Bewusst keine antippbare Zeile um den Schalter: Im Web
 * wäre das ein Bedienelement im Bedienelement (ungültig, siehe pressable-scale).
 */
export function ListSwitch({
  icon,
  title,
  hint,
  value,
  onValueChange,
  disabled = false,
  first = false,
}: RowBase & { value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean }) {
  const colors = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border }, disabled && styles.disabled]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.backgroundSelected }]}>
        <Icon name={icon} size={19} color={colors.tint} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          feedback.selected();
          onValueChange(next);
        }}
        disabled={disabled}
        accessibilityLabel={title}
        accessibilityHint={hint}
        trackColor={{ true: colors.tint }}
      />
    </View>
  );
}

/** Kleiner Hinweis unten in einer Karte (z. B. „Der Versand wird gerade aufgebaut"). */
export function ListNote({ children }: { children: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={[styles.note, { borderTopColor: colors.border }]}>
      <Icon name="info" size={15} color={colors.textSecondary} />
      <Text style={[styles.noteText, { color: colors.textSecondary }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, marginLeft: Spacing.two },
  footer: { fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 18, marginHorizontal: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12, minHeight: 56 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  title: { fontFamily: FontFamily.semibold, fontSize: 15.5 },
  hint: { fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 17 },
  value: { fontFamily: FontFamily.medium, fontSize: 13.5, maxWidth: 140 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 11 },
  disabled: { opacity: 0.5 },
  note: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  noteText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 18 },
});

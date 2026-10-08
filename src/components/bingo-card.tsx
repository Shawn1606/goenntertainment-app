/**
 * Stadt-Bingo – aus der Testphase geholt.
 *
 * Läuft nur, wenn ein Admin es freischaltet (Admin › „Funktionen für alle",
 * zum Ausprobieren „Nur für mich"; src/domain/features.ts). Gerechnet wird auf
 * dem Server (api/app/Support/TestPhase/Bingo.php); ob eine Reihe abholbar ist,
 * sagt allein `claim.claimable`.
 *
 * Wie eine echte Bingo-Karte: Felder mit Symbol oder Partner-Logo, ein
 * erledigtes Feld bekommt einen schrägen „Dauber"-Stempel, der Joker in der
 * Mitte ist frei, volle Reihen werden durchgestrichen. Ein Feld antippen zeigt
 * darunter, was dafür zu tun ist.
 *
 *  - `BingoCard` – die ganze Karte (Bildschirm /bingo).
 *  - `BingoTeaser` – die kleine Vorschau auf der Startseite.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ClaimButton } from '@/components/testphase-ui';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import type { BingoState } from '@/domain/features';
import type { BingoCell, TestphaseClaim } from '@/domain/testphase';
import { isUiIconName, type UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';

/** „Reihe 1", „Spalte 2", „Diagonale" – in der Reihenfolge von Bingo::LINES (3 Reihen, 3 Spalten, 2 Diagonalen). */
export const LINE_NAME = ['Reihe 1', 'Reihe 2', 'Reihe 3', 'Spalte 1', 'Spalte 2', 'Spalte 3', 'Diagonale links oben', 'Diagonale rechts oben'];

/** Weiche Trennstriche (fürs Umbrechen im schmalen Feld) – für Vorleser und Info-Zeile entfernen. */
const SOFT_HYPHEN = /­/g;

/** Wo der Strich über einer vollen Reihe liegt (Anteile der Kartenbreite). */
function strikeStyle(line: number) {
  const centers = ['16.6%', '50%', '83.3%'] as const;
  if (line < 3) return { top: centers[line], left: '4%', width: '92%', marginTop: -3 } as const;
  if (line < 6) return { left: centers[line - 3], top: '4%', height: '92%', width: 6, marginLeft: -3 } as const;
  return { top: '50%', left: '-14%', width: '128%', marginTop: -3, transform: [{ rotate: line === 6 ? '45deg' : '-45deg' }] } as const;
}

export function BingoCard({ bingo, busy, onClaim }: { bingo: BingoState; busy: string | null; onClaim: (c: TestphaseClaim) => void }) {
  const colors = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const fullLines = bingo.lines.filter((l) => l.done);
  const ready = bingo.lines.filter((l) => l.claim.claimable);
  const pick = selected !== null ? (bingo.cells[selected] ?? null) : null;

  return (
    <View style={[styles.bingo, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{bingo.period_label.toUpperCase()}</Text>
          <Text style={styles.title}>Stadt-Bingo</Text>
          <Text style={styles.sub}>Felder in diesem Monat erledigen – volle Reihen bringen Credits.</Text>
        </View>
        <View style={styles.rewards}>
          <View style={styles.reward}>
            <Text style={styles.rewardValue}>+{formatCredits(bingo.line_reward)}</Text>
            <Text style={styles.rewardLabel}>je Reihe</Text>
          </View>
          <View style={[styles.reward, styles.rewardGold]}>
            <Text style={[styles.rewardValue, { color: '#3b2600' }]}>+{formatCredits(bingo.full_reward)}</Text>
            <Text style={[styles.rewardLabel, { color: '#5b3a00' }]}>volle Karte</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.grid}>
          {bingo.cells.map((cell) => (
            <BingoTile key={cell.index} cell={cell} selected={selected === cell.index} onPress={() => setSelected(selected === cell.index ? null : cell.index)} />
          ))}
          {/* Volle Reihen durchstreichen – wie mit dem Marker auf dem Papier. */}
          {fullLines.map((line) => (
            <View key={line.index} pointerEvents="none" style={[styles.strike, { backgroundColor: colors.tint }, strikeStyle(line.index)]} />
          ))}
        </View>

        {pick ? (
          <View style={[styles.pick, { backgroundColor: colors.backgroundSelected }]}>
            <Icon name={pick.done ? 'check' : 'info'} size={18} color={pick.done ? '#059669' : colors.tint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickTitle, { color: colors.text }]}>{pick.label.replace(SOFT_HYPHEN, '')}</Text>
              <Text style={[styles.pickText, { color: colors.textSecondary }]}>
                {pick.kind === 'joker' ? 'Das Feld in der Mitte ist immer frei.' : pick.done ? `Erledigt: ${pick.hint}` : `So geht’s: ${pick.hint}`}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={[styles.tapHint, { color: colors.textSecondary }]}>Tipp auf ein Feld, um zu sehen, was dafür zu tun ist.</Text>
        )}

        <Dots cells={bingo.cells} lines={fullLines.length} />

        {ready.map((line) => (
          <View key={line.index} style={[styles.claimRow, { borderColor: '#f5c542', backgroundColor: 'rgba(245,197,66,0.12)' }]}>
            <Icon name="trophy" size={18} color="#b27b00" />
            <Text style={[styles.claimRowText, { color: colors.text }]}>{LINE_NAME[line.index] ?? 'Reihe'} ist voll!</Text>
            <ClaimButton claim={line.claim} busy={busy} onClaim={onClaim} />
          </View>
        ))}
        <View style={[styles.claimRow, { borderColor: colors.border }]}>
          <Icon name="star-filled" size={18} color={bingo.full.done ? '#b27b00' : colors.textSecondary} />
          <Text style={[styles.claimRowText, { color: colors.text }]}>Volle Karte – alle 9 Felder</Text>
          <ClaimButton claim={bingo.full.claim} busy={busy} onClaim={onClaim} />
        </View>
      </View>
    </View>
  );
}

/** Fortschritt in Punkten: „4/9 Felder · 1 Reihe voll". */
function Dots({ cells, lines }: { cells: BingoCell[]; lines: number }) {
  const colors = useTheme();
  const done = cells.filter((c) => c.done).length;
  return (
    <View style={styles.dots} accessible accessibilityLabel={`${done} von 9 Feldern geschafft`}>
      {cells.map((c) => (
        <View key={c.index} style={[styles.dot, { backgroundColor: c.done ? colors.tint : colors.backgroundSelected }]} />
      ))}
      <Text style={[styles.dotsText, { color: colors.text }]}>
        {done}/9 Felder{lines ? ` · ${lines} ${lines === 1 ? 'Reihe' : 'Reihen'} voll` : ''}
      </Text>
    </View>
  );
}

/** Kleine Vorschau für die Startseite: Mini-Raster, Stand und ein deutliches „Spielen ›". */
export function BingoTeaser({ bingo, onPress }: { bingo: BingoState; onPress: () => void }) {
  const colors = useTheme();
  const done = bingo.cells.filter((c) => c.done).length;
  const ready = bingo.lines.filter((l) => l.claim.claimable).length + (bingo.full.claim.claimable ? 1 : 0);

  return (
    <PressableScale onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`Stadt-Bingo öffnen, ${done} von 9 Feldern`} style={styles.teaser}>
      <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.mini}>
        {bingo.cells.map((c) => (
          <View key={c.index} style={[styles.miniCell, c.kind === 'joker' ? styles.miniJoker : c.done ? { backgroundColor: colors.tint } : null]} />
        ))}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.teaserTitle}>Stadt-Bingo · {bingo.period_label}</Text>
        <Text style={styles.teaserText} numberOfLines={2}>
          {ready > 0 ? `${ready} ${ready === 1 ? 'Belohnung' : 'Belohnungen'} zum Abholen!` : `${done}/9 Felder – volle Reihe = +${formatCredits(bingo.line_reward)} Credits`}
        </Text>
      </View>
      <View style={styles.teaserGo}>
        <Text style={styles.teaserGoText}>Spielen</Text>
        <Icon name="chevron-right" size={14} color={Night.deep} />
      </View>
    </PressableScale>
  );
}

function BingoTile({ cell, selected, onPress }: { cell: BingoCell; selected: boolean; onPress: () => void }) {
  const colors = useTheme();
  const icon: UiIconName = isUiIconName(cell.icon) ? cell.icon : 'star';
  const joker = cell.kind === 'joker';
  // „Demo: " vor Partnernamen frisst im kleinen Feld nur Platz.
  const label = cell.label.replace(/^Demo:\s*/, '');

  return (
    <View style={styles.tileWrap}>
      <PressableScale
        onPress={onPress}
        haptic="select"
        scaleTo={0.95}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${cell.label.replace(SOFT_HYPHEN, '')}: ${cell.hint}${cell.done ? ', erledigt' : ', offen'}`}
        style={[
          styles.tile,
          joker ? styles.tileJoker : { backgroundColor: cell.done ? colors.backgroundSelected : colors.backgroundElement, borderColor: selected ? colors.tint : colors.border },
          selected && styles.tileSelected,
        ]}>
        {joker ? (
          <>
            <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            {/* In einer View: Im Web malt sich der absolut liegende Verlauf sonst über ein nacktes SVG. */}
            <View>
              <Icon name="star-filled" size={28} color="#ffd24a" />
            </View>
            <Text style={styles.jokerText}>FREI</Text>
          </>
        ) : (
          <>
            <View style={[styles.tileIcon, { backgroundColor: colors.background }]}>
              {cell.kind === 'partner' && cell.logo_url ? (
                <Image source={{ uri: cell.logo_url }} style={styles.tileLogo} contentFit="cover" />
              ) : (
                <Icon name={icon} size={18} color={cell.done ? colors.textSecondary : colors.tint} />
              )}
            </View>
            <Text style={[styles.tileLabel, { color: colors.text }, cell.done && styles.tileLabelDone]} numberOfLines={2}>
              {label}
            </Text>
          </>
        )}
        {cell.done && !joker ? <Dauber /> : null}
      </PressableScale>
    </View>
  );
}

/** Der Bingo-Stempel: ein schräger, durchscheinender Kreis mit Haken. */
function Dauber() {
  const colors = useTheme();
  return (
    <View pointerEvents="none" style={styles.dauberWrap}>
      <View style={[styles.dauber, { backgroundColor: colors.tint }]}>
        <Icon name="check" size={22} color="#ffffff" />
      </View>
    </View>
  );
}

const TILE_GAP = 8;

const styles = StyleSheet.create({
  bingo: { borderWidth: Stroke, borderRadius: Radius.panel, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  kicker: { color: Night.sparkle, fontFamily: FontFamily.bold, fontSize: 11.5, letterSpacing: 1 },
  title: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 24, letterSpacing: -0.3 },
  sub: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  rewards: { gap: 6 },
  reward: { alignItems: 'center', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.14)' },
  rewardGold: { backgroundColor: '#f5c542' },
  rewardValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 15 },
  rewardLabel: { color: Night.textMuted, fontFamily: FontFamily.semibold, fontSize: 10.5 },
  body: { padding: Spacing.three, gap: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, aspectRatio: 1, width: '100%' },
  tileWrap: { width: `${(100 - 2 * 2.6) / 3}%`, aspectRatio: 1 },
  tile: { flex: 1, borderWidth: Stroke, borderRadius: Radius.card, padding: 6, alignItems: 'center', justifyContent: 'center', gap: 5, overflow: 'hidden' },
  tileJoker: { borderColor: Night.line, borderWidth: Stroke },
  tileSelected: { borderWidth: 2.5 },
  tileIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileLogo: { width: 36, height: 36 },
  tileLabel: { fontFamily: FontFamily.bold, fontSize: 11.5, lineHeight: 14, textAlign: 'center' },
  tileLabelDone: { opacity: 0.55 },
  jokerText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 2 },
  dauberWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  dauber: { width: '70%', aspectRatio: 1, borderRadius: 999, opacity: 0.82, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-14deg' }] },
  strike: { position: 'absolute', height: 6, borderRadius: 3, opacity: 0.55 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.field, padding: Spacing.three },
  pickTitle: { fontFamily: FontFamily.bold, fontSize: 14.5 },
  pickText: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  tapHint: { fontFamily: FontFamily.medium, fontSize: 12.5, textAlign: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotsText: { fontFamily: FontFamily.bold, fontSize: 13, marginLeft: Spacing.two },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.field, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  claimRowText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14 },
  teaser: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: Radius.card, borderWidth: Stroke, borderColor: Night.line, padding: Spacing.three, overflow: 'hidden' },
  mini: { width: 46, height: 46, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  miniCell: { width: 13, height: 13, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  miniJoker: { backgroundColor: '#ffd24a' },
  teaserTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 15 },
  teaserText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 17 },
  teaserGo: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#ffffff', borderRadius: 999, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 },
  teaserGoText: { color: Night.deep, fontFamily: FontFamily.bold, fontSize: 12.5 },
});

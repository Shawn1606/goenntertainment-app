/**
 * Rechtstexte lesen – Impressum, Nutzungsbedingungen, Haftung, Regeln,
 * Datenschutz.
 *
 * ## Ein Screen für alle fünf
 *
 * Der Parameter `doc` sagt, welches Dokument gemeint ist. Ohne Parameter (oder mit
 * einem unbekannten) erscheint die Übersicht – so ist `/legal` immer eine
 * sinnvolle Adresse und nie eine leere Seite.
 *
 * Fünf eigene Screens wären fünfmal dasselbe Layout. Der Inhalt steht als Daten in
 * `src/domain/legal.ts`, hier ist nur die Schleife darüber.
 *
 * ## Warum die Querverweise unten stehen
 *
 * Am Ende eines Rechtstextes ist genau der Moment, in dem die Anschlussfrage
 * kommt („und wer haftet jetzt?"). Deshalb stehen die verwandten Dokumente dort
 * und nicht in einem Menü.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassCard, SectionHeader } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Links } from '@/constants/links';
import { hasOperatorGaps } from '@/constants/operator';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  LEGAL_DOCUMENTS,
  LEGAL_VERSION,
  legalDocument,
  type LegalDocId,
  type LegalDocument,
} from '@/domain/legal';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { BackButton } from '@/components/ui/icon-button';

/** Symbol je Dokument – dieselbe Sprache wie in den Einstellungen. */
const ICONS: Record<LegalDocId, UiIconName> = {
  terms: 'document',
  liability: 'shield',
  conduct: 'users',
  privacy: 'lock',
  imprint: 'building',
};

export default function LegalScreen() {
  const params = useLocalSearchParams<{ doc?: string }>();
  const doc = legalDocument(params.doc);

  return doc ? <DocumentView doc={doc} /> : <OverviewView />;
}

/* ---------------------------------------------------------------- Übersicht */

function OverviewView() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const router = useRouter();

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}>
        <Header title="Rechtliches" subtitle="Alles an einer Stelle, ohne die App zu verlassen." />

        {LEGAL_DOCUMENTS.map((doc, index) => (
          <Entrance key={doc.id} index={index}>
            <Pressable
              onPress={() => {
                feedback.tapped();
                router.push({ pathname: '/legal', params: { doc: doc.id } });
              }}
              accessibilityRole="button"
              accessibilityLabel={doc.title}
              style={({ pressed }) => pressed && styles.pressed}>
              <GlassCard tone="card" style={styles.docRow}>
                <View
                  style={[
                    styles.docIcon,
                    { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
                  ]}>
                  <Icon name={ICONS[doc.id]} size={20} color={surface.accent} />
                </View>
                <View style={styles.docText}>
                  <ThemedText type="smallBold" style={{ color: surface.text }}>
                    {doc.title}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {doc.summary}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={18} color={surface.textMuted} />
              </GlassCard>
            </Pressable>
          </Entrance>
        ))}

        <PlaceholderWarning />

        <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
          Stand: {LEGAL_VERSION}
        </ThemedText>
      </ScrollView>
    </HomeBackground>
  );
}

/* ---------------------------------------------------------------- Dokument */

function DocumentView({ doc }: { doc: LegalDocument }) {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const router = useRouter();

  const related = (doc.related ?? [])
    .map((id) => legalDocument(id))
    .filter((entry): entry is LegalDocument => entry !== null);

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}>
        <Header title={doc.title} subtitle={doc.summary} />

        {doc.id === 'imprint' ? <PlaceholderWarning /> : null}

        {doc.sections.map((section, index) => (
          <View key={`${section.heading}-${index}`} style={styles.section}>
            <ThemedText type="smallBold" style={[styles.heading, { color: surface.text }]}>
              {section.heading}
            </ThemedText>
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <ThemedText
                key={paragraphIndex}
                style={[styles.paragraph, { color: surface.textMuted }]}>
                {paragraph}
              </ThemedText>
            ))}
          </View>
        ))}

        {related.length > 0 ? (
          <View style={styles.relatedBlock}>
            <SectionHeader title="Passt dazu" />
            {related.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => {
                  feedback.tapped();
                  // `push` und nicht `replace`: Wer von der Haftung zu den
                  // Bedingungen springt, will danach zurück zur Haftung.
                  router.push({ pathname: '/legal', params: { doc: entry.id } });
                }}
                accessibilityRole="button"
                accessibilityLabel={entry.title}
                style={({ pressed }) => pressed && styles.pressed}>
                <GlassCard tone="card" style={styles.docRow}>
                  <Icon name={ICONS[entry.id]} size={18} color={surface.accent} />
                  <View style={styles.docText}>
                    <ThemedText type="smallBold" style={{ color: surface.text }}>
                      {entry.title}
                    </ThemedText>
                  </View>
                  <Icon name="chevron-right" size={18} color={surface.textMuted} />
                </GlassCard>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Die Fassung im Netz ist die zweite Quelle – für alle, die den Text
            weitergeben oder ausdrucken wollen. Sie steht ganz unten, weil der
            vollständige Text ja schon darüber steht. */}
        <Pressable
          onPress={() => {
            const url = doc.id === 'imprint' ? Links.imprint : doc.id === 'privacy' ? Links.privacy : Links.terms;
            WebBrowser.openBrowserAsync(url).catch(() =>
              notifyUser('Link ließ sich nicht öffnen', url),
            );
          }}
          accessibilityRole="link"
          hitSlop={6}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
            Diesen Text im Netz öffnen ›
          </ThemedText>
        </Pressable>

        <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
          Stand: {LEGAL_VERSION}
        </ThemedText>
      </ScrollView>
    </HomeBackground>
  );
}

/* ------------------------------------------------------------------ Bausteine */

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const surface = useBrandSurface();

  return (
    <View style={styles.header}>
      <BackButton />
      <View style={styles.headerText}>
        <ThemedText style={styles.title}>{title}</ThemedText>
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          {subtitle}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * Hinweis, solange im Impressum noch Platzhalter stehen.
 *
 * Steht bewusst IN der App und nicht nur als Kommentar im Code: Ein unvollständiges
 * Impressum ist der klassische Abmahn-Anlass, und ein Kommentar in
 * `src/constants/operator.ts` fällt beim Veröffentlichen niemandem auf. Sind die
 * Daten eingetragen, verschwindet der Kasten von selbst.
 */
function PlaceholderWarning() {
  const surface = useBrandSurface();
  const gaps = hasOperatorGaps();

  if (gaps.length === 0) return null;

  return (
    <GlassCard tone="accent" style={styles.warning}>
      <View style={styles.warningHead}>
        <Icon name="warning" size={18} color={surface.accent} />
        <ThemedText type="smallBold" style={{ color: surface.text }}>
          Noch nicht veröffentlichungsreif
        </ThemedText>
      </View>
      <ThemedText type="small" style={{ color: surface.textMuted }}>
        Im Impressum fehlen noch echte Angaben ({gaps.join(', ')}). Sie stehen in
        src/constants/operator.ts und müssen vor der Veröffentlichung eingetragen werden.
      </ThemedText>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headerText: { flex: 1, gap: Spacing.half },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5 },
  section: { gap: Spacing.two },
  heading: { fontSize: 15 },
  /** Etwas mehr Zeilenabstand als sonst: Das hier wird gelesen, nicht gescannt. */
  paragraph: { lineHeight: 22 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docText: { flex: 1, gap: 1 },
  relatedBlock: { gap: Spacing.two },
  warning: { gap: Spacing.two },
  warningHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  centered: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
});

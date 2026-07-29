import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from '@/components/ui/glass';
import { api, type Interest } from '@/lib/api';
import { FontFamily, Radius, Spacing } from '@/constants/theme';

/** Farbpalette für die Chips – so passt der Picker sowohl in den hellen
 *  Auth-Screen als auch in die theme-abhängigen Einstellungen. */
export type InterestPickerPalette = {
  chipBg: string;
  chipBorder: string;
  chipText: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
  muted: string;
};

type Props = {
  /** Aktuell ausgewählte Interessen-IDs. */
  value: number[];
  onChange: (ids: number[]) => void;
  palette: InterestPickerPalette;
  /** Maximale Auswahl (0/undefiniert = unbegrenzt). */
  max?: number;
  disabled?: boolean;
};

/**
 * Mehrfachauswahl der verfügbaren Interessen als Chip-Liste. Lädt die Liste
 * selbst vom Backend und meldet die Auswahl als ID-Array nach oben.
 */
export function InterestPicker({ value, onChange, palette, max, disabled }: Props) {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    api
      .interests()
      .then((res) => {
        if (alive) setInterests(res.data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function toggle(id: number) {
    if (disabled) return;
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
      return;
    }
    if (max && value.length >= max) return;
    onChange([...value, id]);
  }

  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator size="small" color={palette.activeBorder} />
      </View>
    );
  }

  if (failed || interests.length === 0) {
    return (
      <Text style={[styles.stateText, { color: palette.muted }]}>
        {failed ? 'Interessen konnten nicht geladen werden.' : 'Keine Interessen verfügbar.'}
      </Text>
    );
  }

  return (
    <View style={styles.chips}>
      {interests.map((interest) => {
        const on = value.includes(interest.id);
        const blocked = !on && !!max && value.length >= max;
        return (
          <Pressable
            key={interest.id}
            onPress={() => toggle(interest.id)}
            disabled={disabled || blocked}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: disabled || blocked }}
            style={blocked ? styles.blocked : undefined}>
            {/* Beide Zustände tragen ihre Farbe selbst – als Glas-Pille wären
                sie auf iOS grau und die Auswahl nicht mehr zu erkennen. */}
            <GlassSurface
              tone="accent"
              radius={Radius.chip}
              sheen={false}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? palette.activeBg : palette.chipBg,
                  borderColor: on ? palette.activeBorder : palette.chipBorder,
                },
              ]}>
              <Text style={[styles.chipText, { color: on ? palette.activeText : palette.chipText }]}>
                {interest.name}
              </Text>
            </GlassSurface>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  blocked: {
    opacity: 0.4,
  },
  chip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FontFamily.semibold,
  },
  state: {
    paddingVertical: Spacing.three,
    alignItems: 'flex-start',
  },
  stateText: {
    fontSize: 13,
    paddingVertical: Spacing.two,
  },
});

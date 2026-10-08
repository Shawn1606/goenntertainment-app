import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Night, Stroke } from '@/constants/theme';
import { initialsOf } from '@/domain/initials';
import { useTheme } from '@/hooks/use-theme';

/** Rundes Partner-Logo – ohne Bild die Anfangsbuchstaben („Café am Wall" → „CA") auf Club-Lila. */
export function PartnerLogo({ name, uri, size = 56 }: { name: string; uri: string | null | undefined; size?: number }) {
  const colors = useTheme();
  return (
    <View
      style={[styles.logo, { width: size, height: size, borderRadius: size / 2, borderColor: colors.border }]}
      accessible={false}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Text style={[styles.text, { fontSize: size * 0.34 }]}>{initialsOf(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { borderWidth: Stroke, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: Night.mid },
  text: { color: '#ffffff', fontFamily: FontFamily.bold },
});

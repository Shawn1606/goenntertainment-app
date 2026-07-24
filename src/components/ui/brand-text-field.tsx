import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Brand, Spacing } from '@/constants/theme';

export type BrandTextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
};

/** Eingabefeld im hellen Marken-Stil (weiße Karte), wie `auth-input` im Web. */
export function BrandTextField({ label, error, style, ...rest }: BrandTextFieldProps) {
  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#9ca3af"
        style={[styles.input, { borderColor: error ? '#ef4444' : Brand.inputBorder }, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
  },
  label: {
    marginLeft: Spacing.one,
    fontSize: 13,
    fontWeight: '700',
    color: Brand.textMuted,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: Brand.inputBg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    color: Brand.text,
  },
  error: {
    marginLeft: Spacing.one,
    fontSize: 13,
    color: '#ef4444',
  },
});

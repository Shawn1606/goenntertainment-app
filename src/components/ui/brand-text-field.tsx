import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Brand, Spacing } from '@/constants/theme';

import { EyeIcon, EyeOffIcon } from './icons';

export type BrandTextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  /** Icon links im Feld (z. B. Brief oder Schloss). */
  leftIcon?: ReactNode;
};

/**
 * Eingabefeld im hellen Marken-Stil (weiße Karte), wie `auth-input` im Web.
 * Neu: optionales Icon links, Augen-Umschalter bei Passwörtern, Fokus-Rahmen.
 */
export function BrandTextField({ label, error, leftIcon, style, secureTextEntry, ...rest }: BrandTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);

  const borderColor = error ? '#ef4444' : focused ? Brand.purple : Brand.inputBorder;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.field, { borderColor }]}>
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
        <TextInput
          placeholderTextColor="#9ca3af"
          style={[styles.input, style]}
          secureTextEntry={hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10} style={styles.rightIcon}>
            {hidden ? <EyeIcon /> : <EyeOffIcon />}
          </Pressable>
        ) : null}
      </View>
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: Brand.inputBg,
    paddingHorizontal: Spacing.three,
  },
  leftIcon: {
    marginRight: Spacing.two,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.three,
    fontSize: 16,
    color: Brand.text,
  },
  rightIcon: {
    marginLeft: Spacing.two,
    padding: Spacing.half,
  },
  error: {
    marginLeft: Spacing.one,
    fontSize: 13,
    color: '#ef4444',
  },
});

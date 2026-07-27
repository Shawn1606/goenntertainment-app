import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { LockIcon, MailIcon, UserIcon } from '@/components/ui/icons';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useThemePreference } from '@/lib/theme-preference';

type EditableField = 'email' | 'username';

/**
 * Einstellungen: E-Mail und Benutzername einsehen UND bearbeiten, Passwort
 * ändern (per „Zurücksetzen“-Mail, da das Backend keinen direkten
 * Passwortwechsel im App-Flow anbietet) und den Dark-Mode an-/ausschalten.
 * Alle Flächen nutzen das aufgelöste Theme, dunkeln also im Dark-Mode ab.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const { user, logout, updateProfile } = useAuth();
  const { isDark, setDark } = useThemePreference();

  const [sendingReset, setSendingReset] = useState(false);

  // Inline-Bearbeitung: welches Feld gerade bearbeitet wird + Entwurf/Fehler.
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit(field: EditableField, current: string) {
    setEditing(field);
    setDraft(current);
    setFieldError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setFieldError(null);
  }

  async function saveEdit(field: EditableField) {
    // Benutzername ohne führendes @ speichern.
    const value = field === 'username' ? draft.trim().replace(/^@+/, '') : draft.trim();

    if (!value) {
      setFieldError(field === 'email' ? 'Bitte eine E-Mail angeben.' : 'Bitte einen Benutzernamen angeben.');
      return;
    }

    setSaving(true);
    setFieldError(null);
    try {
      await updateProfile({ [field]: value });
      setEditing(null);
    } catch (err) {
      setFieldError(
        err instanceof ApiError ? err.firstError() : 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword() {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      await api.forgotPassword(user.email);
      Alert.alert(
        'E-Mail unterwegs 📬',
        `Wir haben dir einen Link zum Zurücksetzen deines Passworts an ${user.email} geschickt.`,
      );
    } catch (err) {
      Alert.alert(
        'Fehlgeschlagen',
        err instanceof ApiError
          ? err.firstError()
          : 'Etwas ist schiefgelaufen. Bitte versuch es später erneut.',
      );
    } finally {
      setSendingReset(false);
    }
  }

  function onLogout() {
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: () => logout() },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        keyboardShouldPersistTaps="handled">
        <ThemedText type="subtitle" style={styles.title}>
          Einstellungen
        </ThemedText>

        {/* Konto */}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
          KONTO
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          <EditableRow
            field="email"
            icon={<MailIcon color={colors.tint} />}
            label="E-Mail"
            displayValue={user?.email ?? '—'}
            editValue={user?.email ?? ''}
            keyboardType="email-address"
            colors={colors}
            editing={editing}
            draft={draft}
            onChangeDraft={setDraft}
            error={fieldError}
            saving={saving}
            onStart={startEdit}
            onCancel={cancelEdit}
            onSave={saveEdit}
          />

          <View style={[styles.divider, { backgroundColor: colors.backgroundSelected }]} />

          <EditableRow
            field="username"
            icon={<UserIcon color={colors.tint} />}
            label="Benutzername"
            displayValue={user?.username ? `@${user.username}` : '—'}
            editValue={user?.username ?? ''}
            prefix="@"
            colors={colors}
            editing={editing}
            draft={draft}
            onChangeDraft={setDraft}
            error={fieldError}
            saving={saving}
            onStart={startEdit}
            onCancel={cancelEdit}
            onSave={saveEdit}
          />

          <View style={[styles.divider, { backgroundColor: colors.backgroundSelected }]} />

          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <LockIcon color={colors.tint} />
              <ThemedText type="small" style={{ color: colors.textSecondary }}>
                Passwort
              </ThemedText>
            </View>
            <View style={styles.passwordRight}>
              <ThemedText style={styles.value}>••••••••</ThemedText>
              <Pressable
                onPress={onChangePassword}
                disabled={sendingReset || !user?.email}
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}>
                {sendingReset ? (
                  <ActivityIndicator size="small" color={colors.tint} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: colors.tint }}>
                    Ändern
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        {/* Darstellung */}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
          DARSTELLUNG
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <ThemedText style={styles.rowTitle}>Dark Mode</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Dunklere Farbpalette für die App
              </ThemedText>
            </View>
            <Switch
              value={isDark}
              onValueChange={setDark}
              trackColor={{ true: colors.tint, false: colors.backgroundSelected }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            { borderColor: colors.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={{ color: '#ef4444' }}>
            Abmelden
          </ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type ThemeColors = ReturnType<typeof useTheme>;

/**
 * Konto-Zeile mit Inline-Bearbeitung: zeigt normalerweise Wert + „Bearbeiten“;
 * beim Bearbeiten ein Eingabefeld mit Speichern/Abbrechen.
 */
function EditableRow({
  field,
  icon,
  label,
  displayValue,
  editValue,
  prefix,
  keyboardType = 'default',
  colors,
  editing,
  draft,
  onChangeDraft,
  error,
  saving,
  onStart,
  onCancel,
  onSave,
}: {
  field: EditableField;
  icon: React.ReactNode;
  label: string;
  displayValue: string;
  editValue: string;
  prefix?: string;
  keyboardType?: 'default' | 'email-address';
  colors: ThemeColors;
  editing: EditableField | null;
  draft: string;
  onChangeDraft: (value: string) => void;
  error: string | null;
  saving: boolean;
  onStart: (field: EditableField, current: string) => void;
  onCancel: () => void;
  onSave: (field: EditableField) => void;
}) {
  const isEditing = editing === field;

  if (!isEditing) {
    return (
      <View style={styles.row}>
        <View style={styles.rowLabel}>
          {icon}
          <ThemedText type="small" style={{ color: colors.textSecondary }}>
            {label}
          </ThemedText>
        </View>
        <View style={styles.passwordRight}>
          <ThemedText numberOfLines={1} style={styles.value}>
            {displayValue}
          </ThemedText>
          <Pressable
            onPress={() => onStart(field, editValue)}
            disabled={editing !== null}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText
              type="smallBold"
              style={{ color: editing !== null ? colors.textSecondary : colors.tint }}>
              Bearbeiten
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.editRow}>
      <View style={styles.rowLabel}>
        {icon}
        <ThemedText type="small" style={{ color: colors.textSecondary }}>
          {label}
        </ThemedText>
      </View>

      <View
        style={[
          styles.inputWrap,
          { backgroundColor: colors.background, borderColor: error ? '#ef4444' : colors.backgroundSelected },
        ]}>
        {prefix ? (
          <ThemedText style={{ color: colors.textSecondary }}>{prefix}</ThemedText>
        ) : null}
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType}
          editable={!saving}
          placeholderTextColor={colors.textSecondary}
          onSubmitEditing={() => onSave(field)}
          style={[styles.input, { color: colors.text }]}
        />
      </View>

      {error ? (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.editActions}>
        <Pressable
          onPress={onCancel}
          disabled={saving}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={{ color: colors.textSecondary }}>
            Abbrechen
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => onSave(field)}
          disabled={saving}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <ThemedText type="smallBold" style={{ color: colors.tint }}>
              Speichern
            </ThemedText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  title: {
    marginBottom: Spacing.four,
  },
  sectionLabel: {
    marginBottom: Spacing.two,
    marginLeft: Spacing.one,
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 18,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  editRow: {
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  rowLeft: {
    flexShrink: 1,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowTitle: {
    fontWeight: '600',
  },
  value: {
    fontWeight: '600',
    flexShrink: 1,
  },
  passwordRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    gap: Spacing.half,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  logoutButton: {
    marginTop: 'auto',
    alignSelf: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: 999,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});

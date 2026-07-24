import { Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { api, ApiError, type User } from '@/lib/api';

// Vorerst wird der Admin nur an dieser E-Mail erkannt. Eine echte Admin-Rolle
// (Flag/Rechte im Backend) kommt später als eigenes Ticket.
const ADMIN_EMAIL = 'admin@goe4fun.sh';

/**
 * Admin-Panel als Teil der App, gedacht für die Bedienung im Browser (Web-Build).
 * Eigener, vom normalen App-Login getrennter Zugang. Aktuell nur Grundgerüst:
 * Login + leeres Dashboard.
 */
export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const [admin, setAdmin] = useState<User | null>(null);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, title: 'Admin' }} />
      {admin ? (
        <AdminDashboard admin={admin} onLogout={() => setAdmin(null)} topInset={insets.top} />
      ) : (
        <AdminLogin onSuccess={setAdmin} topInset={insets.top} />
      )}
    </View>
  );
}

function AdminLogin({ onSuccess, topInset }: { onSuccess: (u: User) => void; topInset: number }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogin() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      if (res.user.email.toLowerCase() !== ADMIN_EMAIL) {
        setError('Dieser Account hat keinen Admin-Zugang.');
        return;
      }
      onSuccess(res.user);
    } catch (e) {
      setError(e instanceof ApiError ? e.firstError() : 'Unbekannter Fehler.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.centered, { paddingTop: topInset + Spacing.six }]} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.badge}>ADMIN</Text>
            <BrandGradientText style={styles.title}>Admin-Login</BrandGradientText>
            <Text style={styles.subtitle}>Nur für Administratoren.</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <BrandTextField
            label="E-Mail"
            value={email}
            onChangeText={setEmail}
            placeholder="admin@…"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            leftIcon={<MailIcon />}
          />
          <BrandTextField
            label="Passwort"
            value={password}
            onChangeText={setPassword}
            placeholder="Passwort"
            secureTextEntry
            autoComplete="current-password"
            leftIcon={<LockIcon />}
          />

          <BrandButton title="Anmelden" onPress={onLogin} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AdminDashboard({ admin, onLogout, topInset }: { admin: User; onLogout: () => void; topInset: number }) {
  return (
    <ScrollView contentContainerStyle={[styles.dashboard, { paddingTop: topInset + Spacing.four }]}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.badge}>ADMIN</Text>
          <BrandGradientText style={styles.dashTitle}>Dashboard</BrandGradientText>
        </View>
        <Pressable onPress={onLogout} style={styles.logout}>
          <Text style={styles.logoutText}>Abmelden</Text>
        </Pressable>
      </View>

      <Text style={styles.hello}>Angemeldet als {admin.name} ({admin.email})</Text>

      <View style={styles.grid}>
        <PlaceholderCard label="Nutzer" hint="Verwaltung kommt bald" />
        <PlaceholderCard label="Aktivitäten" hint="Verwaltung kommt bald" />
      </View>

      <Text style={styles.note}>
        Dies ist das Grundgerüst. Funktionen (Nutzer/Aktivitäten verwalten) folgen als eigene Schritte.
      </Text>
    </ScrollView>
  );
}

function PlaceholderCard({ label, hint }: { label: string; hint: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>–</Text>
      <Text style={styles.statHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6f4fb',
  },
  flex: { flex: 1 },
  centered: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ece9fe',
    padding: Spacing.four,
    gap: Spacing.three,
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#7c3aed',
        shadowOpacity: 0.12,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: Brand.purple,
    backgroundColor: '#f5f3ff',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Brand.textMuted,
  },
  error: {
    color: '#ef4444',
    textAlign: 'center',
  },
  dashboard: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dashTitle: {
    fontSize: 30,
    fontWeight: '800',
  },
  logout: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  logoutText: {
    color: Brand.text,
    fontWeight: '600',
  },
  hello: {
    fontSize: 14,
    color: Brand.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 160,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ece9fe',
    padding: Spacing.four,
    gap: Spacing.one,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.text,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Brand.purple,
  },
  statHint: {
    fontSize: 12,
    color: Brand.textMuted,
  },
  note: {
    fontSize: 13,
    color: Brand.textMuted,
  },
});

import { Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { Brand, MaxContentWidth, Spacing, FontFamily, Radius } from '@/constants/theme';
import { api, ApiError, needsTwoFactor, type User } from '@/lib/api';

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
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);

  async function onLogin() {
    setLoading(true);
    setError(null);
    try {
      const first = await api.login(email.trim(), password);
      // Mit Zwei-Faktor-Anmeldung braucht auch der Admin-Zugang den Code – sonst
      // wäre diese Seite der Weg, den zweiten Faktor zu umgehen.
      let res;
      if (needsTwoFactor(first)) {
        if (!code.trim()) {
          setNeedsCode(true);
          setChallenge(first.two_factor.challenge);
          setError(
            first.two_factor.method === 'email'
              ? `Wir haben dir einen Code an ${first.two_factor.destination ?? 'deine E-Mail'} geschickt.`
              : 'Gib den Code aus deiner Authenticator-App ein.',
          );
          return;
        }
        res = await api.loginTwoFactor(challenge ?? first.two_factor.challenge, code.trim());
      } else {
        res = first;
      }
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

  // Tastatur-Freistellung übernimmt `KeyboardForm` (siehe dort).
  return (
    <View style={styles.flex}>
      <KeyboardForm contentContainerStyle={[styles.centered, { paddingTop: topInset + Spacing.six }]}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.badge}>ADMIN</Text>
            <BrandGradientText style={styles.title}>Admin-Login</BrandGradientText>
            <Text style={styles.subtitle}>Nur für Administratoren.</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextField
            label="E-Mail"
            value={email}
            onChangeText={setEmail}
            placeholder="admin@…"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            leftIcon={<MailIcon />}
          />
          <TextField
            label="Passwort"
            value={password}
            onChangeText={setPassword}
            placeholder="Passwort"
            secureTextEntry
            autoComplete="current-password"
            leftIcon={<LockIcon />}
          />

          {needsCode ? (
            <TextField
              label="Bestätigungscode"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              leftIcon={<LockIcon />}
            />
          ) : null}

          <BrandButton title="Anmelden" onPress={onLogin} loading={loading} />
        </View>
      </KeyboardForm>
    </View>
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
    borderRadius: Radius.panel,
    borderWidth: 1,
    borderColor: '#ece9fe',
    padding: Spacing.four,
    gap: Spacing.three,
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#4f46e5',
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
    backgroundColor: 'rgba(99,102,241,0.10)',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
    fontFamily: FontFamily.bold,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    fontFamily: FontFamily.bold,
  },
  subtitle: {
    fontSize: 14,
    color: Brand.textMuted,
    fontFamily: FontFamily.regular,
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
    fontFamily: FontFamily.bold,
  },
  logout: {
    borderRadius: Radius.field,
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
    fontFamily: FontFamily.regular,
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
    fontFamily: FontFamily.bold,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Brand.purple,
    fontFamily: FontFamily.bold,
  },
  statHint: {
    fontSize: 12,
    color: Brand.textMuted,
    fontFamily: FontFamily.regular,
  },
  note: {
    fontSize: 13,
    color: Brand.textMuted,
    fontFamily: FontFamily.regular,
  },
});

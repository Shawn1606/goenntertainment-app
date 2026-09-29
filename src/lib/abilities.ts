import { Features } from '@/constants/features';
import { accountAbilities } from '@/domain/account';

type AbilityUser = Parameters<typeof accountAbilities>[0];

/**
 * Darf dieses Konto Aktivitäten erstellen?
 *
 * Solange die Kontostufen ausgeblendet sind (`Features.accountTiers`), JEDES
 * Konto. Sonst wäre das Erstellen – der Kern der App – hinter einer Stufe
 * versteckt, die man in der App gar nicht mehr erreichen kann. Der Server trifft
 * dieselbe Entscheidung (server/src/features.js).
 */
export function canCreateActivities(user: AbilityUser): boolean {
  return !Features.accountTiers || accountAbilities(user).canCreateActivities;
}

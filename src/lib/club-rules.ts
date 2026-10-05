import rules from '../../shared/club.json';

import type { ClubRules } from '@/domain/club';

/**
 * Die Club-Regeln aus shared/club.json – dieselbe Datei, mit der Laravel rechnet.
 *
 * Die Domain-Funktionen (src/domain/club.ts) nehmen die Regeln als Parameter,
 * damit ihre Tests ohne Metro laufen. In der App kommen sie von hier.
 */
export const CLUB_RULES = rules as unknown as ClubRules;

import { API_URL } from '@/constants/config';
import { authImageSource, type AuthImageSource } from '@/domain/auth-image';

/**
 * The expo-image source for an image the server hands out: private images under this app's API
 * (evidence, story images; F-11) carry the session's bearer token, every other address stays
 * plain. The rule lives in src/domain/auth-image.ts.
 */
export function apiImageSource(uri: string, token: string | null | undefined): AuthImageSource {
  return authImageSource(uri, token, API_URL);
}

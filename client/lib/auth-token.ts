import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Bearer token storage.
 *
 * The token is a real credential, so it lives in the Keychain via SecureStore
 * rather than AsyncStorage, which is unencrypted and readable from a backup or
 * a jailbroken device. Previously the client sent the raw user id as its
 * credential and kept it in AsyncStorage — anyone who read that value, or
 * simply guessed a user id, was that user.
 *
 * SecureStore has no web implementation, so the web build falls back to
 * localStorage. That is weaker, and web is a development convenience here, not
 * a target for patient data.
 */

const TOKEN_KEY = "nexus_auth_token";

const isWeb = Platform.OS === "web";

export async function saveAuthToken(token: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getAuthToken(): Promise<string | null> {
  try {
    if (isWeb) {
      return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    }
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function clearAuthToken(): Promise<void> {
  try {
    if (isWeb) {
      globalThis.localStorage?.removeItem(TOKEN_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already absent; nothing to do.
  }
}

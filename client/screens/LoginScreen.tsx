import React, { useState } from "react";
import { View, StyleSheet, Platform, Alert, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { hapticFeedback } from "@/lib/haptics";

const PRIVACY_POLICY_URL = "https://github.com/Kilment/nexus-face/blob/main/PRIVACY.md";
const TERMS_URL = "https://github.com/Kilment/nexus-face/blob/main/LICENSE";

/**
 * Sign in with Apple only.
 *
 * Email/password sign-in was removed along with the server endpoints backing
 * it: that account system had no verification and no reset, and sat beside an
 * ungated development login that minted a session for any address supplied.
 * Apple provides a verified identity and an optional private relay address,
 * which suits an app that touches clinical photographs.
 */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { signInWithApple, isAppleAuthAvailable } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleAppleSignIn = async () => {
    hapticFeedback.medium();
    setIsLoading(true);
    try {
      await signInWithApple();
      hapticFeedback.success();
    } catch (error: any) {
      // Dismissing the sheet is not an error worth surfacing.
      if (error?.code === "ERR_REQUEST_CANCELED") return;
      hapticFeedback.error();
      Alert.alert(
        "Sign-In Failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + Spacing["3xl"],
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={styles.title}>Nexus</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Before And After Facial Analysis
          </ThemedText>
        </View>

        <View style={[styles.notice, { borderColor: theme.warning }]}>
          <ThemedText style={[styles.noticeText, { color: theme.textSecondary }]}>
            Research tool, not a medical device. Results are model estimates of
            appearance and must not guide clinical decisions.
          </ThemedText>
        </View>

        <View style={styles.actions}>
          {isAppleAuthAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                isDark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={BorderRadius.md}
              style={styles.appleButton}
              onPress={() => {
                if (!isLoading) void handleAppleSignIn();
              }}
            />
          ) : (
            <ThemedText style={[styles.unavailable, { color: theme.textSecondary }]}>
              {Platform.OS === "ios"
                ? "Sign in with Apple is unavailable on this device. Check that you are signed in to iCloud."
                : "This build supports Sign in with Apple on iOS only."}
            </ThemedText>
          )}
        </View>

        <View style={styles.legal}>
          <ThemedText style={[styles.legalText, { color: theme.textTertiary }]}>
            By continuing you agree to the{" "}
            <ThemedText
              style={[styles.link, { color: theme.tabIconSelected }]}
              onPress={() => Linking.openURL(TERMS_URL)}
            >
              Terms
            </ThemedText>{" "}
            and{" "}
            <ThemedText
              style={[styles.link, { color: theme.tabIconSelected }]}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            >
              Privacy Policy
            </ThemedText>
            .
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: "space-between",
  },
  header: { alignItems: "center", marginTop: Spacing["3xl"] },
  title: { fontSize: 40, fontWeight: "700", letterSpacing: -1 },
  subtitle: { fontSize: 16, marginTop: Spacing.sm, textAlign: "center" },
  notice: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.xl,
  },
  noticeText: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  actions: { marginTop: Spacing.xl },
  appleButton: { width: "100%", height: 50 },
  unavailable: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  legal: { marginTop: Spacing.xl },
  legalText: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  link: { fontSize: 12, textDecorationLine: "underline" },
});

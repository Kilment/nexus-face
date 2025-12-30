import React, { useState } from "react";
import { View, StyleSheet, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { hapticFeedback } from "@/lib/haptics";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    hapticFeedback.medium();
    setIsLoading(true);
    try {
      await login();
      hapticFeedback.success();
    } catch (error) {
      hapticFeedback.error();
      Alert.alert("Login Failed", "Unable to sign in. Please try again.");
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
            paddingTop: insets.top + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.logoSection}>
          <View style={styles.logoWrapper}>
            {Platform.OS === "ios" ? (
              <BlurView
                intensity={60}
                tint={isDark ? "dark" : "light"}
                style={styles.logoGlass}
              >
                <Image
                  source={require("../../assets/images/icon.png")}
                  style={styles.logo}
                  contentFit="contain"
                />
              </BlurView>
            ) : (
              <View
                style={[
                  styles.logoGlass,
                  {
                    backgroundColor: isDark
                      ? "rgba(44, 44, 46, 0.9)"
                      : "rgba(255, 255, 255, 0.9)",
                  },
                ]}
              >
                <Image
                  source={require("../../assets/images/icon.png")}
                  style={styles.logo}
                  contentFit="contain"
                />
              </View>
            )}
          </View>
          <ThemedText style={styles.title}>DE-ID</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.tabIconSelected }]}>
            Face
          </ThemedText>
          <ThemedText style={[styles.tagline, { color: theme.textSecondary }]}>
            Anonymize and organize facial photos
          </ThemedText>
        </View>

        <View style={styles.buttonSection}>
          <GlassButton
            title={isLoading ? "Signing in..." : "Get Started"}
            icon={isLoading ? undefined : "log-in"}
            onPress={handleLogin}
            disabled={isLoading}
            loading={isLoading}
            size="large"
          />

          <ThemedText style={[styles.termsText, { color: theme.textTertiary }]}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: "space-between",
  },
  logoSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.xs,
  },
  logoWrapper: {
    borderRadius: 40,
    overflow: "hidden",
    marginBottom: Spacing.lg,
  },
  logoGlass: {
    width: 140,
    height: 140,
    borderRadius: 35,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  logo: {
    width: 100,
    height: 100,
  },
  title: {
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: 4,
    textTransform: "uppercase",
    marginTop: -4,
  },
  tagline: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    marginTop: Spacing.md,
  },
  buttonSection: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  termsText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});

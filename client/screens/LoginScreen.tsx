import React, { useState } from "react";
import { View, StyleSheet, Platform, Alert, TextInput, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassButton } from "@/components/GlassButton";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { hapticFeedback } from "@/lib/haptics";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { login, signup } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing Fields", "Please enter both email and password.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters.");
      return;
    }

    hapticFeedback.medium();
    setIsLoading(true);
    try {
      if (isSignUp) {
        await signup(email.trim(), password, username.trim() || undefined);
      } else {
        await login(email.trim(), password);
      }
      hapticFeedback.success();
    } catch (error) {
      hapticFeedback.error();
      const message = error instanceof Error ? error.message : "Please try again.";
      Alert.alert(isSignUp ? "Sign Up Failed" : "Login Failed", message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    hapticFeedback.light();
    setIsSignUp(!isSignUp);
    setEmail("");
    setPassword("");
    setUsername("");
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
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
            Anonymize Medical Facial Photos
          </ThemedText>
        </View>

        <View style={styles.formSection}>
          {isSignUp ? (
            <View
              style={[
                styles.inputContainer,
                {
                  backgroundColor: isDark
                    ? "rgba(44, 44, 46, 0.8)"
                    : "rgba(255, 255, 255, 0.8)",
                  borderColor: theme.border,
                },
              ]}
            >
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="Username (optional)"
                placeholderTextColor={theme.textTertiary}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}

          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: isDark
                  ? "rgba(44, 44, 46, 0.8)"
                  : "rgba(255, 255, 255, 0.8)",
                borderColor: theme.border,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Email"
              placeholderTextColor={theme.textTertiary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />
          </View>

          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: isDark
                  ? "rgba(44, 44, 46, 0.8)"
                  : "rgba(255, 255, 255, 0.8)",
                borderColor: theme.border,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Password"
              placeholderTextColor={theme.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
            />
          </View>

          <GlassButton
            title={isLoading ? (isSignUp ? "Creating Account..." : "Signing in...") : (isSignUp ? "Sign Up" : "Log In")}
            icon={isLoading ? undefined : (isSignUp ? "user-plus" : "log-in")}
            onPress={handleSubmit}
            disabled={isLoading}
            loading={isLoading}
            size="large"
          />

          <Pressable onPress={toggleMode} style={styles.toggleButton}>
            <ThemedText style={[styles.toggleText, { color: theme.tabIconSelected }]}>
              {isSignUp ? "Already have an account? Log In" : "No Account? Sign Up!"}
            </ThemedText>
          </Pressable>

          <ThemedText style={[styles.termsText, { color: theme.textTertiary }]}>
            By continuing, you agree to our terms of service and privacy policy.
          </ThemedText>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
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
    width: 120,
    height: 120,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  logo: {
    width: 80,
    height: 80,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 4,
    textTransform: "uppercase",
    marginTop: -4,
  },
  tagline: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginTop: Spacing.sm,
  },
  formSection: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  inputContainer: {
    height: 52,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  input: {
    fontSize: 16,
    height: "100%",
  },
  toggleButton: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "600",
  },
  termsText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});

import React, { useState } from "react";
import { View, StyleSheet, Pressable, Alert, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HeaderButton } from "@react-navigation/elements";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { apiRequest, queryClient } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type TaggingRouteProp = RouteProp<RootStackParamList, "Tagging">;

export default function TaggingScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<TaggingRouteProp>();
  const { processedImageBase64 } = route.params;

  const [initials, setInitials] = useState("");
  const [beforeAfter, setBeforeAfter] = useState<"before" | "after">("before");
  const [locationCode, setLocationCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const isFormValid = initials.length >= 2 && initials.length <= 3 && locationCode.length > 0;

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <HeaderButton
          onPress={() => navigation.goBack()}
          pressColor={theme.tabIconSelected}
        >
          <ThemedText style={{ color: theme.tabIconSelected }}>Cancel</ThemedText>
        </HeaderButton>
      ),
      headerRight: () => (
        <HeaderButton
          onPress={handleSave}
          disabled={!isFormValid || isSaving}
          pressColor={theme.tabIconSelected}
        >
          <ThemedText
            style={{
              color: isFormValid && !isSaving ? theme.tabIconSelected : theme.textTertiary,
              fontWeight: "600",
            }}
          >
            Save
          </ThemedText>
        </HeaderButton>
      ),
    });
  }, [navigation, isFormValid, isSaving, theme]);

  const handleSave = async () => {
    if (!isFormValid || isSaving) return;

    setIsSaving(true);
    try {
      await apiRequest("POST", "/api/photos", {
        processedImageBase64,
        initials: initials.toUpperCase(),
        beforeAfter,
        locationCode,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      navigation.popToTop();
    } catch (error) {
      console.error("Save error:", error);
      Alert.alert("Error", "Failed to save photo. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={[styles.imageContainer, { backgroundColor: theme.cardBackground }]}>
          <Image
            source={{ uri: `data:image/png;base64,${processedImageBase64}` }}
            style={styles.processedImage}
            contentFit="contain"
          />
        </View>

        <View style={styles.formContainer}>
          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Initials</ThemedText>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundDefault,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={initials}
              onChangeText={(text) => setInitials(text.slice(0, 3).toUpperCase())}
              placeholder="2-3 characters"
              placeholderTextColor={theme.textTertiary}
              maxLength={3}
              autoCapitalize="characters"
            />
            {initials.length > 0 && initials.length < 2 && (
              <ThemedText style={[styles.hint, { color: theme.error }]}>
                Minimum 2 characters
              </ThemedText>
            )}
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Type</ThemedText>
            <View style={styles.segmentedControl}>
              <Pressable
                style={[
                  styles.segmentButton,
                  {
                    backgroundColor:
                      beforeAfter === "before" ? theme.warning : theme.backgroundDefault,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setBeforeAfter("before")}
              >
                <ThemedText
                  style={[
                    styles.segmentText,
                    { color: beforeAfter === "before" ? "#FFFFFF" : theme.text },
                  ]}
                >
                  Before
                </ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.segmentButton,
                  {
                    backgroundColor:
                      beforeAfter === "after" ? theme.success : theme.backgroundDefault,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setBeforeAfter("after")}
              >
                <ThemedText
                  style={[
                    styles.segmentText,
                    { color: beforeAfter === "after" ? "#FFFFFF" : theme.text },
                  ]}
                >
                  After
                </ThemedText>
              </Pressable>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Location Code</ThemedText>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundDefault,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={locationCode}
              onChangeText={setLocationCode}
              placeholder="e.g., NYC-01"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="characters"
            />
          </View>
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
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xl,
  },
  imageContainer: {
    alignSelf: "center",
    width: 200,
    height: 240,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  processedImage: {
    width: "100%",
    height: "100%",
  },
  formContainer: {
    gap: Spacing.lg,
  },
  inputGroup: {
    gap: Spacing.sm,
  },
  label: {
    ...Typography.h4,
  },
  input: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    ...Typography.body,
  },
  hint: {
    ...Typography.small,
  },
  segmentedControl: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  segmentButton: {
    flex: 1,
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentText: {
    ...Typography.button,
  },
});

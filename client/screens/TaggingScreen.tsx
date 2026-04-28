import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Platform,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation, useRoute, RouteProp, StackActions } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { IosNumericInputAccessory } from "@/components/IosNumericInputAccessory";
import { useTheme } from "@/hooks/useTheme";
import {
  PHOTO_TAG_FIELD_PRIVACY,
  photoMetaKeyboardDismissOnDone,
  photoMetaNumericAccessoryId,
} from "@/lib/photo-meta-text-input";
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
  const [weeksAfter, setWeeksAfter] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const isFormValid = initials.length >= 2 && initials.length <= 3 && locationCode.length > 0;

  const handleSave = useCallback(async () => {
    if (!isFormValid || isSaving) return;

    Keyboard.dismiss();
    setIsSaving(true);
    try {
      await apiRequest("POST", "/api/photos", {
        processedImageBase64,
        initials: initials.toUpperCase(),
        beforeAfter,
        locationCode,
        weeksAfter: beforeAfter === "after" && weeksAfter ? parseInt(weeksAfter) : null,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      const popCount = Math.min(2, navigation.getState().routes.length - 1);
      if (popCount > 0) {
        navigation.dispatch(StackActions.pop(popCount));
      }

      const rootNav = navigation.getParent();
      if (rootNav) {
        rootNav.navigate("Main", {
          screen: "GalleryTab",
          params: {
            screen: "Gallery",
            params: { scrollToTop: true },
          },
        });
      }
    } catch (error) {
      console.error("Save error:", error);
      Alert.alert("Error", "Failed to save photo. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [
    isFormValid,
    isSaving,
    navigation,
    processedImageBase64,
    beforeAfter,
    locationCode,
    weeksAfter,
  ]);

  React.useLayoutEffect(() => {
    /**
     * react-native-screens 4.16 doesn't yet wire up native UIBarButtonItem mapping for
     * `unstable_headerLeftItems` / `unstable_headerRightItems`, so use plain JSX with
     * fully symmetric padding (no wrapper View, no margin, no minWidth) — iOS 26
     * liquid-glass capsule then sizes itself around shrink-wrapped content.
     */
    navigation.setOptions({
      headerShown: true,
      headerTitle: "Tag Photo",
      headerLeft: () => (
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerNavBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={[styles.headerNavLabel, { color: theme.tabIconSelected }]}>
            Cancel
          </Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          onPress={handleSave}
          disabled={!isFormValid || isSaving}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerNavBtn,
            { opacity: !isFormValid || isSaving ? 1 : pressed ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save"
        >
          <Text
            style={[
              styles.headerNavLabel,
              styles.headerNavLabelEmphasis,
              {
                color: isFormValid && !isSaving ? theme.tabIconSelected : theme.textTertiary,
              },
            ]}
          >
            Save
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, handleSave, isFormValid, isSaving, theme]);

  return (
    <ThemedView style={styles.container}>
      <IosNumericInputAccessory tintColor={theme.tabIconSelected} />
      {isSaving && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.tabIconSelected} />
          <ThemedText style={styles.loadingText}>Saving Photo...</ThemedText>
        </View>
      )}
      <KeyboardAwareScrollViewCompat
        keyboardDismissMode="interactive"
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
              {...PHOTO_TAG_FIELD_PRIVACY}
              {...photoMetaKeyboardDismissOnDone()}
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
              placeholder="2-3 Characters"
              placeholderTextColor={theme.textTertiary}
              maxLength={3}
              autoCapitalize="characters"
            />
            {initials.length > 0 && initials.length < 2 && (
              <ThemedText style={[styles.hint, { color: theme.error }]}>
                Minimum 2 Characters
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
              {...PHOTO_TAG_FIELD_PRIVACY}
              {...photoMetaKeyboardDismissOnDone()}
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

          {beforeAfter === "after" && (
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Weeks After Intervention (Optional)</ThemedText>
              <TextInput
                {...PHOTO_TAG_FIELD_PRIVACY}
                {...photoMetaNumericAccessoryId()}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundDefault,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                value={weeksAfter}
                onChangeText={(text) => setWeeksAfter(text.replace(/[^0-9]/g, ""))}
                placeholder="e.g., 2"
                placeholderTextColor={theme.textTertiary}
                keyboardType="number-pad"
              />
            </View>
          )}
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
    ...(Platform.OS === "ios"
      ? { alignSelf: "stretch", overflow: "hidden" }
      : null),
  },
  segmentText: {
    ...Typography.button,
    textAlign: "center",
    lineHeight: 22,
    ...(Platform.OS === "ios" ? { width: "100%" } : null),
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  loadingText: {
    marginTop: Spacing.md,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  /**
   * Symmetric padding only — no margin, no minWidth, no wrapper Views. iOS 26
   * liquid-glass capsule then wraps the shrink-wrapped Text with system insets
   * and the label sits centered.
   */
  headerNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerNavLabel: {
    fontSize: 17,
    fontWeight: "400",
  },
  headerNavLabelEmphasis: {
    fontWeight: "600",
  },
});

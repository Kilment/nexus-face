import React, { useState, useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
  TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { useAuth, type User } from "@/lib/auth-context";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";
import { apiRequest, queryClient } from "@/lib/query-client";
import { ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { NOT_AVAILABLE } from "@/lib/format-demographics";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";

interface PhotoPair {
  studyId?: string | null;
  beforePhoto: {
    id: string;
    processedImageUrl: string;
    initials: string;
  };
  afterPhoto: {
    id: string;
    processedImageUrl: string;
    initials: string;
  };
  metrics: {
    deltaPredictedFacialAge: number | null;
    deltaWrinkles: number | null;
    perceivedSkinFirmnessDelta: number | null;
    confidence?: number | null;
  };
}

interface UserStats {
  totalPhotos: number;
  linkedPairs: number;
  averageDeltaPredictedAge: number | null;
  averageDeltaWrinkles: number | null;
  averagePerceivedFirmnessDelta: number | null;
  recentPairs: PhotoPair[];
}

const PAIR_IMAGE_SIZE = (Dimensions.get("window").width - Spacing.lg * 3) / 2 - Spacing.md;

export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  /** Tab bar measured height excludes its bottom margin; match CameraScreen / StudiesList clearance above floating tab bar. */
  const footerBottomInset = tabBarHeight + insets.bottom + Spacing.lg + Spacing.sm;
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
  const { user, logout, deleteAccount, setUser } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || "");
  const usernameInputRef = useRef<TextInput>(null);

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: { username?: string; profileImageUrl?: string | null }) => {
      const response = await apiRequest("PATCH", "/api/auth/profile", payload);
      return response.json() as Promise<{ user: User }>;
    },
    onSuccess: async (
      data,
      variables,
    ) => {
      // The user object is display state only; the credential is the token.
      setUser(data.user);
      if ("username" in variables && variables.username !== undefined) {
        setIsEditingUsername(false);
      }
      hapticFeedback.success();
    },
    onError: (error: any) => {
      Alert.alert("Error", error.message || "Failed to update profile");
      hapticFeedback.error();
    },
  });

  const handleUpdateUsername = () => {
    if (newUsername.trim().length < 2) {
      Alert.alert("Error", "Username must be at least 2 characters");
      return;
    }
    updateProfileMutation.mutate({ username: newUsername.trim() });
  };

  const promptProfilePhoto = () => {
    if (updateProfileMutation.isPending) return;
    const buttons: {
      text: string;
      style?: "cancel" | "destructive";
      onPress?: () => void;
    }[] = [
      {
        text: "Choose Photo",
        onPress: () => launchProfileImagePicker(),
      },
    ];
    if (user?.profileImageUrl) {
      buttons.push({
        text: "Remove Photo",
        style: "destructive",
        onPress: () => updateProfileMutation.mutate({ profileImageUrl: null }),
      });
    }
    buttons.push({
      text: "Cancel",
      style: "cancel",
      onPress: () => {},
    });
    Alert.alert("Profile Photo", "Tap Choose Photo or remove the current picture.", buttons);
  };

  async function launchProfileImagePicker() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Needed",
          "Allow photo library access so you can choose a profile picture.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.42,
        base64: true,
      });
      if (result.canceled || !result.assets[0]?.base64) return;
      const asset = result.assets[0];
      const mimeRaw = asset.mimeType?.toLowerCase() ?? "image/jpeg";
      let mimeSubtype = mimeRaw.replace(/^image\//, "");
      if (mimeSubtype === "jpg") mimeSubtype = "jpeg";
      const allowed = new Set(["jpeg", "png", "webp"]);
      if (!allowed.has(mimeSubtype)) mimeSubtype = "jpeg";
      const profileImageUrl = `data:image/${mimeSubtype};base64,${asset.base64}`;
      updateProfileMutation.mutate({ profileImageUrl });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not open photo library.";
      Alert.alert("Error", message);
    }
  }

  const startEditing = () => {
    setNewUsername(user?.username || "");
    setIsEditingUsername(true);
    setTimeout(() => usernameInputRef.current?.focus(), 100);
  };

  const { data: statsData, isLoading: statsLoading } = useQuery<{ stats: UserStats }>({
    queryKey: ["/api/stats"],
  });

  const stats = statsData?.stats;

  const logoutInProgress = React.useRef(false);

  const performLogout = async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;
    setIsLoggingOut(true);
    hapticFeedback.medium();
    try {
      await logout();
      hapticFeedback.success();
    } catch {
      hapticFeedback.error();
      Alert.alert("Logout Failed", "Unable to log out. Please try again.");
    } finally {
      logoutInProgress.current = false;
      setIsLoggingOut(false);
    }
  };

  const handleLogout = () => {
    if (isLoggingOut || logoutInProgress.current) return;
    hapticFeedback.warning();
    Alert.alert(
      "Log Out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: () => {
            performLogout();
          },
        },
      ]
    );
  };

  /**
   * Apple requires in-app account deletion for any app offering account
   * creation. This is a permanent server-side delete: photos, studies and
   * analyses cascade, so no patient image survives the account.
   */
  const handleDeleteAccount = () => {
    hapticFeedback.warning();
    Alert.alert(
      "Delete Account",
      "This permanently deletes your account and every photo, study and analysis "
        + "stored with it. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Everything",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Confirm Deletion",
              "Last check. Your data cannot be recovered after this.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      await deleteAccount();
                      hapticFeedback.success();
                    } catch (error) {
                      hapticFeedback.error();
                      Alert.alert(
                        "Deletion Failed",
                        error instanceof Error ? error.message : "Please try again.",
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  /**
   * An undetermined value reads as N/A. It is never rendered as 0.0, and the
   * unit is dropped with it so nothing reads as "N/AY".
   */
  const formatSigned = (value: number | null | undefined, digits = 1, unit = "") => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return NOT_AVAILABLE;
    }
    return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;
  };

  const navigateFromRecentComparison = React.useCallback(
    (pair: PhotoPair) => {
      hapticFeedback.medium();
      if (pair.studyId) {
        navigation.navigate("StudyResults", { studyId: pair.studyId });
        return;
      }
      const tabNav = navigation.getParent();
      if (typeof tabNav?.navigate !== "function") return;
      (tabNav.navigate as (name: string, params?: object) => void)("GalleryTab", {
        screen: "LinkedPair",
        params: {
          photoId: pair.beforePhoto.id,
          linkedPhotoId: pair.afterPhoto.id,
        },
      });
    },
    [navigation],
  );

  const renderStatCard = (title: string, value: string, icon: keyof typeof Feather.glyphMap, highlight?: boolean) => (
    <GlassCard style={styles.statCard}>
      <View style={styles.statContent}>
        <Feather name={icon} size={20} color={highlight ? theme.tabIconSelected : theme.textSecondary} />
        <ThemedText style={[styles.statValue, highlight ? { color: theme.tabIconSelected } : null]}>
          {value}
        </ThemedText>
        <ThemedText style={[styles.statTitle, { color: theme.textSecondary }]}>
          {title}
        </ThemedText>
      </View>
    </GlassCard>
  );

  const renderPairItem = (pair: PhotoPair) => (
    <Pressable
      key={`${pair.beforePhoto.id}-${pair.afterPhoto.id}`}
      onPress={() => navigateFromRecentComparison(pair)}
      accessibilityRole="button"
      accessibilityHint={
        pair.studyId
          ? "Opens cohort analysis results"
          : "Opens this paired comparison in Gallery"
      }
      accessibilityLabel="Recent comparison"
      style={({ pressed }) => [styles.pairPressable, pressed && styles.pairPressablePressed]}
    >
      <GlassCard style={styles.pairCard}>
        <View style={styles.pairImages}>
          <View style={styles.pairImageContainer}>
            <Image
              source={{ uri: pair.beforePhoto.processedImageUrl }}
              style={styles.pairImage}
              contentFit="cover"
            />
            <ThemedText style={[styles.pairLabel, { color: theme.warning }]}>Before</ThemedText>
          </View>
          <View style={styles.pairArrow}>
            <Feather name="arrow-right" size={18} color={theme.textSecondary} />
          </View>
          <View style={styles.pairImageContainer}>
            <Image
              source={{ uri: pair.afterPhoto.processedImageUrl }}
              style={styles.pairImage}
              contentFit="cover"
            />
            <ThemedText style={[styles.pairLabel, { color: theme.success }]}>After</ThemedText>
          </View>
        </View>
        <View style={styles.pairScoreContainer}>
          <ThemedText style={[styles.pairInitials, { color: theme.textSecondary }]}>
            {pair.beforePhoto.initials}
          </ThemedText>
          <ThemedText style={[styles.pairScore, { color: theme.tabIconSelected }]}>
            ΔAge {formatSigned(pair.metrics.deltaPredictedFacialAge, 1, "Y")}
          </ThemedText>
          <ThemedText style={[styles.pairConfidence, { color: theme.textTertiary }]}>
            ΔWrinkles {formatSigned(pair.metrics.deltaWrinkles)} · Firmness {formatSigned(pair.metrics.perceivedSkinFirmnessDelta)}
          </ThemedText>
        </View>
      </GlassCard>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: footerBottomInset + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <View style={styles.avatarStack}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens photo library"
              accessibilityLabel="Update profile photo"
              onPress={() => {
                hapticFeedback.light();
                promptProfilePhoto();
              }}
              disabled={updateProfileMutation.isPending}
            >
              <View style={styles.avatarWrapper}>
                {Platform.OS === "ios" ? (
                  <BlurView
                    intensity={50}
                    tint={isDark ? "dark" : "light"}
                    style={[styles.avatarContainer, styles.avatarGlass]}
                  >
                    {user?.profileImageUrl ? (
                      <Image
                        source={{ uri: user.profileImageUrl }}
                        style={styles.avatar}
                        contentFit="cover"
                      />
                    ) : (
                      <Feather name="user" size={48} color={theme.textSecondary} />
                    )}
                  </BlurView>
                ) : (
                  <View
                    style={[
                      styles.avatarContainer,
                      {
                        backgroundColor: isDark
                          ? "rgba(44, 44, 46, 0.9)"
                          : "rgba(245, 245, 245, 0.9)",
                      },
                    ]}
                  >
                    {user?.profileImageUrl ? (
                      <Image
                        source={{ uri: user.profileImageUrl }}
                        style={styles.avatar}
                        contentFit="cover"
                      />
                    ) : (
                      <Feather name="user" size={48} color={theme.textSecondary} />
                    )}
                  </View>
                )}
              </View>
            </Pressable>
            {updateProfileMutation.isPending ? (
              <View style={styles.avatarLoadingOverlay} pointerEvents="none">
                <ActivityIndicator size="large" color={theme.tabIconSelected} />
              </View>
            ) : null}
          </View>

          <View style={styles.usernameContainer}>
            {isEditingUsername ? (
              <View style={styles.editContainer}>
                <TextInput
                  ref={usernameInputRef}
                  style={[styles.usernameInput, { color: theme.text, borderColor: theme.tabIconSelected }]}
                  value={newUsername}
                  onChangeText={setNewUsername}
                  autoFocus
                  placeholder="Username"
                  placeholderTextColor={theme.textTertiary}
                  maxLength={20}
                />
                <View style={styles.editButtons}>
                  <Pressable onPress={() => setIsEditingUsername(false)} style={styles.editIconButton}>
                    <Feather name="x" size={20} color={theme.error} />
                  </Pressable>
                  <Pressable onPress={handleUpdateUsername} disabled={updateProfileMutation.isPending} style={styles.editIconButton}>
                    {updateProfileMutation.isPending ? (
                      <ActivityIndicator size="small" color={theme.tabIconSelected} />
                    ) : (
                      <Feather name="check" size={20} color={theme.success} />
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={startEditing} style={styles.usernameWrapper}>
                <ThemedText style={styles.username}>{user?.username || "Anonymous"}</ThemedText>
                <Feather name="edit-2" size={14} color={theme.textTertiary} style={styles.editIcon} />
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            Your Stats
          </ThemedText>
          {statsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.tabIconSelected} />
            </View>
          ) : stats ? (
            <>
              <View style={styles.statsGrid}>
                {renderStatCard("Photos", stats.totalPhotos.toString(), "camera")}
                {renderStatCard("Pairs", stats.linkedPairs.toString(), "link")}
              </View>
              {stats.linkedPairs > 0 ? (
                <View style={styles.statsGrid}>
                  {renderStatCard("Avg ΔAge", formatSigned(stats.averageDeltaPredictedAge, 1, "Y"), "clock", true)}
                  {renderStatCard("Avg ΔWrk", formatSigned(stats.averageDeltaWrinkles), "activity")}
                </View>
              ) : null}
              {stats.linkedPairs > 0 ? (
                <View style={styles.statsGrid}>
                  {renderStatCard("Avg Firmness", formatSigned(stats.averagePerceivedFirmnessDelta), "wind")}
                </View>
              ) : null}
            </>
          ) : (
            <GlassCard>
              <View style={styles.emptyStats}>
                <Feather name="bar-chart-2" size={32} color={theme.textTertiary} />
                <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                  Take before/after photos to see your improvement stats.
                </ThemedText>
              </View>
            </GlassCard>
          )}
        </View>

        {stats && stats.recentPairs.length > 0 ? (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Recent Comparisons
            </ThemedText>
            {stats.recentPairs.slice(0, 1).map(renderPairItem)}
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            Research cohorts
          </ThemedText>
          <Pressable
            onPress={() => {
              hapticFeedback.light();
              navigation.navigate("StudiesList");
            }}
          >
            <GlassCard style={styles.cohortLink}>
              <View style={styles.cohortLinkRow}>
                <Feather name="layers" size={22} color={theme.tabIconSelected} />
                <View style={styles.cohortLinkText}>
                  <ThemedText style={[styles.cohortTitle, { color: theme.text }]}>
                    Photo Cohort Analysis
                  </ThemedText>
                  <ThemedText style={[styles.cohortSubtitle, { color: theme.textSecondary }]}>
                    Before Vs After Interventions, Exploratory Endpoints
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={22} color={theme.textSecondary} />
              </View>
            </GlassCard>
          </Pressable>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            Account
          </ThemedText>
          <GlassButton
            title="Log Out"
            icon="log-out"
            variant="destructive"
            onPress={handleLogout}
          />
          <View style={{ height: Spacing.sm }} />
          <GlassButton
            title="Delete Account"
            icon="trash-2"
            variant="destructive"
            onPress={handleDeleteAccount}
          />
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            About
          </ThemedText>
          <GlassCard>
            <View style={styles.aboutRow}>
              <Feather name="info" size={18} color={theme.textSecondary} />
              <ThemedText style={[styles.aboutLabel, { color: theme.textSecondary }]}>
                Version
              </ThemedText>
              <ThemedText style={styles.aboutValue}>1.0.0</ThemedText>
            </View>
          </GlassCard>
        </View>

        <ThemedText style={[styles.footer, { color: theme.textTertiary }]}>
          Nexus - Anonymize Facial Photos & Analyze Results
        </ThemedText>
      </ScrollView>
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
  profileSection: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  avatarStack: {
    width: 110,
    height: 110,
    alignSelf: "center",
    position: "relative",
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 55,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarWrapper: {
    borderRadius: 60,
    overflow: "hidden",
    width: 110,
    height: 110,
  },
  avatarContainer: {
    width: 110,
    height: 110,
    borderRadius: 55,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarGlass: {
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  username: {
    ...Typography.h2,
  },
  usernameContainer: {
    minHeight: 40,
    justifyContent: "center",
  },
  usernameWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  editIcon: {
    marginTop: 4,
  },
  editContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  usernameInput: {
    ...Typography.h2,
    minWidth: 150,
    padding: 0,
    margin: 0,
  },
  editButtons: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  editIconButton: {
    padding: Spacing.xs,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.small,
    textTransform: "uppercase",
    marginLeft: Spacing.sm,
    letterSpacing: 1,
  },
  loadingContainer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  statsGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  statCard: {
    flex: 1,
  },
  statContent: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  statValue: {
    fontSize: 26,
    fontWeight: "700",
  },
  statTitle: {
    ...Typography.small,
  },
  emptyStats: {
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
  },
  pairPressable: {
    alignSelf: "stretch",
    borderRadius: BorderRadius.lg,
  },
  pairPressablePressed: {
    opacity: 0.93,
  },
  pairCard: {
    marginBottom: Spacing.sm,
  },
  pairImages: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  pairImageContainer: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  pairImage: {
    width: PAIR_IMAGE_SIZE,
    height: PAIR_IMAGE_SIZE * 1.3,
    borderRadius: BorderRadius.md,
  },
  pairArrow: {
    paddingHorizontal: Spacing.xs,
  },
  pairLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  pairScoreContainer: {
    marginTop: Spacing.md,
    alignItems: "center",
  },
  pairInitials: {
    ...Typography.small,
    fontWeight: "600",
  },
  pairScore: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: Spacing.xs,
  },
  pairConfidence: {
    ...Typography.small,
    marginTop: 2,
  },
  cohortLink: {
    padding: Spacing.md,
  },
  cohortLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  cohortLinkText: {
    flex: 1,
    gap: 4,
  },
  cohortTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  cohortSubtitle: {
    ...Typography.small,
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  aboutLabel: {
    flex: 1,
    ...Typography.body,
  },
  aboutValue: {
    ...Typography.body,
    fontWeight: "600",
  },
  footer: {
    ...Typography.small,
    textAlign: "center",
    marginTop: Spacing.xl,
  },
});

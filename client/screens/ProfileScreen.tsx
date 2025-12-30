import React from "react";
import { View, StyleSheet, Pressable, Alert, ActivityIndicator, Dimensions, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
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
import { useAuth } from "@/lib/auth-context";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";
import { ScrollView } from "react-native";

interface PhotoPair {
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
  improvementScore: number;
  percentage: number;
  confidenceLow: number;
  confidenceHigh: number;
}

interface UserStats {
  totalPhotos: number;
  linkedPairs: number;
  averageImprovement: number;
  bestImprovement: number;
  worstImprovement: number;
  recentPairs: PhotoPair[];
}

const PAIR_IMAGE_SIZE = (Dimensions.get("window").width - Spacing.lg * 3) / 2 - Spacing.md;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme, isDark } = useTheme();
  const { user, logout } = useAuth();

  const { data: statsData, isLoading: statsLoading } = useQuery<{ stats: UserStats }>({
    queryKey: ["/api/stats"],
  });

  const stats = statsData?.stats;

  const handleLogout = () => {
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
            hapticFeedback.medium();
            logout();
          },
        },
      ]
    );
  };

  const formatPercentage = (value: number) => {
    return value > 0 ? `+${value}%` : `${value}%`;
  };

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
    <GlassCard key={`${pair.beforePhoto.id}-${pair.afterPhoto.id}`} style={styles.pairCard}>
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
          {formatPercentage(pair.percentage)}
        </ThemedText>
        <ThemedText style={[styles.pairConfidence, { color: theme.textTertiary }]}>
          95% CI = {pair.confidenceLow}% - {pair.confidenceHigh}%
        </ThemedText>
      </View>
    </GlassCard>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
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
          <ThemedText style={styles.username}>{user?.username || "User"}</ThemedText>
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
                  {renderStatCard("Average", formatPercentage(stats.averageImprovement), "trending-up", true)}
                  {renderStatCard("Best", formatPercentage(stats.bestImprovement), "award")}
                </View>
              ) : null}
            </>
          ) : (
            <GlassCard>
              <View style={styles.emptyStats}>
                <Feather name="bar-chart-2" size={32} color={theme.textTertiary} />
                <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                  Take before/after photos to see your improvement stats
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
            {stats.recentPairs.map(renderPairItem)}
          </View>
        ) : null}

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
          FaceSnap - Process and organize facial photos
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
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  avatarWrapper: {
    borderRadius: 60,
    overflow: "hidden",
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

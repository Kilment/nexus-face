import React from "react";
import { View, StyleSheet, Pressable, Alert, ActivityIndicator, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/lib/auth-context";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
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
  const { theme } = useTheme();
  const { user, logout } = useAuth();

  const { data: statsData, isLoading: statsLoading } = useQuery<{ stats: UserStats }>({
    queryKey: ["/api/stats"],
  });

  const stats = statsData?.stats;

  const handleLogout = () => {
    Alert.alert(
      "Log Out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: logout,
        },
      ]
    );
  };

  const formatPercentage = (value: number) => {
    return value > 0 ? `+${value}%` : `${value}%`;
  };

  const renderStatCard = (title: string, value: string, subtitle?: string, highlight?: boolean) => (
    <View style={[styles.statCard, { backgroundColor: theme.backgroundDefault }]}>
      <ThemedText style={[styles.statValue, highlight ? { color: theme.tabIconSelected } : null]}>
        {value}
      </ThemedText>
      <ThemedText style={[styles.statTitle, { color: theme.textSecondary }]}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText style={[styles.statSubtitle, { color: theme.textTertiary }]}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );

  const renderPairItem = ({ item }: { item: PhotoPair }) => (
    <View style={[styles.pairCard, { backgroundColor: theme.backgroundDefault }]}>
      <View style={styles.pairImages}>
        <View style={styles.pairImageContainer}>
          <Image
            source={{ uri: item.beforePhoto.processedImageUrl }}
            style={styles.pairImage}
            contentFit="cover"
          />
          <ThemedText style={[styles.pairLabel, { color: theme.textSecondary }]}>Before</ThemedText>
        </View>
        <Feather name="arrow-right" size={20} color={theme.textSecondary} />
        <View style={styles.pairImageContainer}>
          <Image
            source={{ uri: item.afterPhoto.processedImageUrl }}
            style={styles.pairImage}
            contentFit="cover"
          />
          <ThemedText style={[styles.pairLabel, { color: theme.textSecondary }]}>After</ThemedText>
        </View>
      </View>
      <View style={styles.pairScoreContainer}>
        <ThemedText style={[styles.pairInitials, { color: theme.textSecondary }]}>
          {item.beforePhoto.initials}
        </ThemedText>
        <ThemedText style={[styles.pairScore, { color: theme.tabIconSelected }]}>
          {formatPercentage(item.percentage)} improvement
        </ThemedText>
        <ThemedText style={[styles.pairConfidence, { color: theme.textTertiary }]}>
          95% CI = {item.confidenceLow}% - {item.confidenceHigh}%
        </ThemedText>
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <View style={[styles.avatarContainer, { backgroundColor: theme.backgroundSecondary }]}>
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
                {renderStatCard("Total Photos", stats.totalPhotos.toString())}
                {renderStatCard("Linked Pairs", stats.linkedPairs.toString())}
              </View>
              {stats.linkedPairs > 0 ? (
                <View style={styles.statsGrid}>
                  {renderStatCard(
                    "Average",
                    formatPercentage(stats.averageImprovement),
                    "improvement",
                    true
                  )}
                  {renderStatCard(
                    "Best",
                    formatPercentage(stats.bestImprovement),
                    "improvement"
                  )}
                </View>
              ) : null}
            </>
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                Start taking before/after photos to see your improvement stats
              </ThemedText>
            </View>
          )}
        </View>

        {stats && stats.recentPairs.length > 0 ? (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Recent Comparisons
            </ThemedText>
            {stats.recentPairs.map((pair, index) => (
              <View key={`${pair.beforePhoto.id}-${pair.afterPhoto.id}`}>
                {renderPairItem({ item: pair })}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            Account
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.menuItemPressed,
              ]}
              onPress={handleLogout}
            >
              <Feather name="log-out" size={20} color={theme.error} />
              <ThemedText style={[styles.menuItemText, { color: theme.error }]}>
                Log Out
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            About
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.menuItem}>
              <Feather name="info" size={20} color={theme.textSecondary} />
              <View style={styles.menuItemContent}>
                <ThemedText style={styles.menuItemText}>Version</ThemedText>
                <ThemedText style={[styles.menuItemValue, { color: theme.textSecondary }]}>
                  1.0.0
                </ThemedText>
              </View>
            </View>
          </View>
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
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
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
  },
  card: {
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.md,
  },
  menuItemPressed: {
    opacity: 0.7,
  },
  menuItemContent: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  menuItemText: {
    ...Typography.body,
  },
  menuItemValue: {
    ...Typography.body,
  },
  footer: {
    ...Typography.small,
    textAlign: "center",
    marginTop: Spacing.xl,
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
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
  },
  statTitle: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  statSubtitle: {
    ...Typography.small,
    fontSize: 10,
  },
  emptyCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
  },
  pairCard: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  pairImages: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  pairImageContainer: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  pairImage: {
    width: PAIR_IMAGE_SIZE,
    height: PAIR_IMAGE_SIZE * 1.3,
    borderRadius: 9999,
  },
  pairLabel: {
    ...Typography.small,
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
});

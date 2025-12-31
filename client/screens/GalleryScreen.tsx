import React, { useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { FilterChip } from "@/components/FilterChip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";
import type { GalleryStackParamList } from "@/navigation/GalleryStackNavigator";
import type { Photo } from "@shared/schema";

type NavigationProp = NativeStackNavigationProp<GalleryStackParamList>;

interface PhotosResponse {
  photos: Photo[];
}

type FilterType = "all" | "before" | "after" | "linked" | "unlinked";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  const { data, isLoading, refetch, isRefetching } = useQuery<PhotosResponse>({
    queryKey: ["/api/photos"],
  });

  const photos = data?.photos || [];

  const uniqueInitials = useMemo(() => {
    const initials = new Set(photos.map((p) => p.initials));
    return Array.from(initials).sort();
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    return photos.filter((photo) => {
      if (searchQuery) {
        const query = searchQuery.toUpperCase();
        const matchesSearch =
          photo.initials.toUpperCase().includes(query) ||
          photo.locationCode.toUpperCase().includes(query);
        if (!matchesSearch) return false;
      }

      switch (activeFilter) {
        case "before":
          return photo.beforeAfter === "before";
        case "after":
          return photo.beforeAfter === "after";
        case "linked":
          return photo.linkedPhotoId !== null;
        case "unlinked":
          return photo.linkedPhotoId === null;
        default:
          return true;
      }
    });
  }, [photos, searchQuery, activeFilter]);

  const handlePhotoPress = (photo: Photo) => {
    hapticFeedback.light();
    if (photo.linkedPhotoId) {
      navigation.navigate("LinkedPair", {
        photoId: photo.id,
        linkedPhotoId: photo.linkedPhotoId,
      });
    } else {
      navigation.navigate("PhotoDetail", { photoId: photo.id });
    }
  };

  const handleFilterChange = (filter: FilterType) => {
    setActiveFilter(filter);
  };

  const renderPhoto = ({ item }: { item: Photo }) => {
    const borderColor =
      item.beforeAfter === "before" ? theme.warning : theme.success;

    return (
      <PhotoCard
        photo={item}
        borderColor={borderColor}
        theme={theme}
        isDark={isDark}
        onPress={() => handlePhotoPress(item)}
      />
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="camera" size={64} color={theme.textTertiary} />
      <ThemedText style={[styles.emptyTitle, { color: theme.textSecondary }]}>
        No photos yet
      </ThemedText>
      <ThemedText style={[styles.emptyText, { color: theme.textTertiary }]}>
        Take or upload a photo to get started
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.searchContainer, { marginTop: headerHeight + Spacing.sm }]}>
        <View style={styles.searchBarWrapper}>
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={60}
              tint={isDark ? "dark" : "light"}
              style={[styles.searchBar, styles.glassSearchBar]}
            >
              <Feather name="search" size={18} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search initials or location..."
                placeholderTextColor={theme.textTertiary}
              />
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery("")}>
                  <Feather name="x" size={18} color={theme.textSecondary} />
                </Pressable>
              ) : null}
            </BlurView>
          ) : (
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: isDark
                    ? "rgba(60, 60, 67, 0.5)"
                    : "rgba(120, 120, 128, 0.16)",
                },
              ]}
            >
              <Feather name="search" size={18} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search initials or location..."
                placeholderTextColor={theme.textTertiary}
              />
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery("")}>
                  <Feather name="x" size={18} color={theme.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChips}
        >
          <FilterChip
            label="All"
            selected={activeFilter === "all"}
            onPress={() => handleFilterChange("all")}
          />
          <FilterChip
            label="Before"
            selected={activeFilter === "before"}
            onPress={() => handleFilterChange("before")}
            icon="arrow-left"
          />
          <FilterChip
            label="After"
            selected={activeFilter === "after"}
            onPress={() => handleFilterChange("after")}
            icon="arrow-right"
          />
          <FilterChip
            label="Linked"
            selected={activeFilter === "linked"}
            onPress={() => handleFilterChange("linked")}
            icon="link"
          />
          <FilterChip
            label="Unlinked"
            selected={activeFilter === "unlinked"}
            onPress={() => handleFilterChange("unlinked")}
            icon="link-2"
          />
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.tabIconSelected} />
        </View>
      ) : (
        <FlatList
          data={filteredPhotos}
          renderItem={renderPhoto}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: tabBarHeight + Spacing.xl },
          ]}
          columnWrapperStyle={styles.columnWrapper}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={theme.tabIconSelected}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

interface PhotoCardProps {
  photo: Photo;
  borderColor: string;
  theme: any;
  isDark: boolean;
  onPress: () => void;
}

function PhotoCard({ photo, borderColor, theme, isDark, onPress }: PhotoCardProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 150 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 150 });
  };

  return (
    <AnimatedPressable
      style={[styles.photoCard, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <View style={styles.photoCardInner}>
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={40}
            tint={isDark ? "dark" : "light"}
            style={styles.photoCardBackground}
          >
            <View style={[styles.photoImageContainer, { borderColor, borderWidth: 2 }]}>
              <Image
                source={{ uri: photo.processedImageUrl }}
                style={styles.photoImage}
                contentFit="cover"
              />
              {photo.linkedPhotoId ? (
                <View style={[styles.linkBadge, { backgroundColor: theme.tabIconSelected }]}>
                  <Feather name="link" size={12} color="#FFFFFF" />
                </View>
              ) : null}
              {(photo.gender || photo.ageRange || photo.ethnicity) ? (
                <View style={styles.demographicBadge}>
                  <ThemedText style={styles.demographicText}>
                    {photo.gender ? `${photo.gender.charAt(0)}` : ""}{photo.ageRange ? ` • ${photo.ageRange}` : ""}{photo.ethnicity ? ` • ${photo.ethnicity}` : ""}
                  </ThemedText>
                </View>
              ) : null}
              {photo.weeksAfter !== null ? (
                <View style={styles.weeksBadge}>
                  <ThemedText style={styles.weeksText}>{photo.weeksAfter}W</ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.photoInfo}>
              <ThemedText style={styles.initials}>{photo.initials}</ThemedText>
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: photo.beforeAfter === "before" ? theme.warning : theme.success },
                ]}
              >
                <ThemedText style={styles.typeBadgeText}>
                  {photo.beforeAfter === "before" ? "B" : "A"}
                </ThemedText>
              </View>
            </View>
          </BlurView>
        ) : (
          <View
            style={[
              styles.photoCardBackground,
              {
                backgroundColor: isDark
                  ? "rgba(44, 44, 46, 0.9)"
                  : "rgba(255, 255, 255, 0.9)",
              },
            ]}
          >
            <View style={[styles.photoImageContainer, { borderColor, borderWidth: 2 }]}>
              <Image
                source={{ uri: photo.processedImageUrl }}
                style={styles.photoImage}
                contentFit="cover"
              />
              {photo.linkedPhotoId ? (
                <View style={[styles.linkBadge, { backgroundColor: theme.tabIconSelected }]}>
                  <Feather name="link" size={12} color="#FFFFFF" />
                </View>
              ) : null}
              {(photo.gender || photo.ageRange || photo.ethnicity) ? (
                <View style={styles.demographicBadge}>
                  <ThemedText style={styles.demographicText}>
                    {photo.gender ? `${photo.gender.charAt(0)}` : ""}{photo.ageRange ? ` • ${photo.ageRange}` : ""}{photo.ethnicity ? ` • ${photo.ethnicity}` : ""}
                  </ThemedText>
                </View>
              ) : null}
              {photo.weeksAfter !== null ? (
                <View style={styles.weeksBadge}>
                  <ThemedText style={styles.weeksText}>{photo.weeksAfter}W</ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.photoInfo}>
              <ThemedText style={styles.initials}>{photo.initials}</ThemedText>
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: photo.beforeAfter === "before" ? theme.warning : theme.success },
                ]}
              >
                <ThemedText style={styles.typeBadgeText}>
                  {photo.beforeAfter === "before" ? "B" : "A"}
                </ThemedText>
              </View>
            </View>
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    gap: Spacing.sm,
  },
  searchBarWrapper: {
    paddingHorizontal: Spacing.lg,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  glassSearchBar: {
    overflow: "hidden",
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
  },
  filterChips: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    padding: Spacing.sm,
    flexGrow: 1,
  },
  columnWrapper: {
    gap: Spacing.sm,
  },
  photoCard: {
    flex: 1,
    margin: Spacing.xs,
  },
  photoCardInner: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  photoCardBackground: {
    padding: Spacing.sm,
  },
  photoImageContainer: {
    aspectRatio: 3 / 4,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  photoImage: {
    width: "100%",
    height: "100%",
  },
  linkBadge: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  photoInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Spacing.sm,
  },
  initials: {
    ...Typography.h4,
  },
  typeBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  typeBadgeText: {
    ...Typography.small,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  demographicBadge: {
    position: "absolute",
    top: Spacing.xs,
    left: Spacing.xs,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  demographicText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  weeksBadge: {
    position: "absolute",
    bottom: Spacing.xs,
    left: Spacing.xs,
    backgroundColor: "rgba(0, 122, 255, 0.85)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  weeksText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing["5xl"],
    gap: Spacing.md,
  },
  emptyTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
  },
});

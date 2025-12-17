import React, { useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import type { GalleryStackParamList } from "@/navigation/GalleryStackNavigator";
import type { Photo } from "@shared/schema";

type NavigationProp = NativeStackNavigationProp<GalleryStackParamList>;

interface PhotosResponse {
  photos: Photo[];
}

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch, isRefetching } = useQuery<PhotosResponse>({
    queryKey: ["/api/photos"],
  });

  const photos = data?.photos || [];

  const filteredPhotos = photos.filter((photo) => {
    if (!searchQuery) return true;
    const query = searchQuery.toUpperCase();
    return (
      photo.initials.toUpperCase().includes(query) ||
      photo.locationCode.toUpperCase().includes(query)
    );
  });

  const handlePhotoPress = (photo: Photo) => {
    if (photo.linkedPhotoId) {
      navigation.navigate("LinkedPair", {
        photoId: photo.id,
        linkedPhotoId: photo.linkedPhotoId,
      });
    } else {
      navigation.navigate("PhotoDetail", { photoId: photo.id });
    }
  };

  const renderPhoto = ({ item }: { item: Photo }) => {
    const borderColor =
      item.beforeAfter === "before" ? theme.warning : theme.success;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.photoCard,
          { backgroundColor: theme.cardBackground },
          pressed && styles.photoCardPressed,
        ]}
        onPress={() => handlePhotoPress(item)}
      >
        <View style={[styles.photoImageContainer, { borderColor, borderWidth: 2 }]}>
          <Image
            source={{ uri: item.processedImageUrl }}
            style={styles.photoImage}
            contentFit="cover"
          />
          {item.linkedPhotoId && (
            <View style={[styles.linkBadge, { backgroundColor: theme.tabIconSelected }]}>
              <Feather name="link" size={12} color="#FFFFFF" />
            </View>
          )}
        </View>
        <View style={styles.photoInfo}>
          <ThemedText style={styles.initials}>{item.initials}</ThemedText>
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: item.beforeAfter === "before" ? theme.warning : theme.success },
            ]}
          >
            <ThemedText style={styles.typeBadgeText}>
              {item.beforeAfter === "before" ? "B" : "A"}
            </ThemedText>
          </View>
        </View>
      </Pressable>
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
      <View style={[styles.searchContainer, { borderBottomColor: theme.border }]}>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by initials or location..."
            placeholderTextColor={theme.textTertiary}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")}>
              <Feather name="x" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
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
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  photoCardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
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
    padding: Spacing.sm,
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

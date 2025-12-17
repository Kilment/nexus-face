import React from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { apiRequest, queryClient } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { Photo } from "@shared/schema";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type LinkPhotoRouteProp = RouteProp<RootStackParamList, "LinkPhoto">;

interface LinkablePhotosResponse {
  photos: Photo[];
}

export default function LinkPhotoScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<LinkPhotoRouteProp>();
  const { photoId } = route.params;

  const { data, isLoading } = useQuery<LinkablePhotosResponse>({
    queryKey: ["/api/photos", photoId, "linkable"],
  });

  const linkMutation = useMutation({
    mutationFn: async (linkedPhotoId: string) => {
      await apiRequest("POST", `/api/photos/${photoId}/link`, { linkedPhotoId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      navigation.goBack();
    },
    onError: () => {
      Alert.alert("Error", "Failed to link photos.");
    },
  });

  const linkablePhotos = data?.photos || [];

  const handleLink = (linkedPhoto: Photo) => {
    Alert.alert(
      "Link Photos",
      `Link this photo with the ${linkedPhoto.beforeAfter} photo (${linkedPhoto.initials})?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Link",
          onPress: () => linkMutation.mutate(linkedPhoto.id),
        },
      ]
    );
  };

  const renderPhoto = ({ item }: { item: Photo }) => {
    const borderColor = item.beforeAfter === "before" ? theme.warning : theme.success;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.photoCard,
          { backgroundColor: theme.cardBackground },
          pressed && styles.photoCardPressed,
        ]}
        onPress={() => handleLink(item)}
      >
        <View style={[styles.photoImageContainer, { borderColor, borderWidth: 2 }]}>
          <Image
            source={{ uri: item.processedImageUrl }}
            style={styles.photoImage}
            contentFit="cover"
          />
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
              {item.beforeAfter === "before" ? "Before" : "After"}
            </ThemedText>
          </View>
        </View>
        <ThemedText style={[styles.locationCode, { color: theme.textSecondary }]}>
          {item.locationCode}
        </ThemedText>
      </Pressable>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="link-2" size={64} color={theme.textTertiary} />
      <ThemedText style={[styles.emptyTitle, { color: theme.textSecondary }]}>
        No matching photos
      </ThemedText>
      <ThemedText style={[styles.emptyText, { color: theme.textTertiary }]}>
        Take a photo with the same initials but opposite type (Before/After) to link
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText style={[styles.headerText, { color: theme.textSecondary }]}>
          Select a photo to link with. Photos must have the same initials and be the opposite type (Before/After).
        </ThemedText>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.tabIconSelected} />
        </View>
      ) : (
        <FlatList
          data={linkablePhotos}
          renderItem={renderPhoto}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          ListEmptyComponent={renderEmpty}
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
  header: {
    padding: Spacing.lg,
  },
  headerText: {
    ...Typography.body,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    flexGrow: 1,
  },
  photoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.md,
  },
  photoCardPressed: {
    opacity: 0.7,
  },
  photoImageContainer: {
    width: 60,
    height: 75,
    borderRadius: BorderRadius.xs,
    overflow: "hidden",
  },
  photoImage: {
    width: "100%",
    height: "100%",
  },
  photoInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  initials: {
    ...Typography.h4,
  },
  typeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  typeBadgeText: {
    ...Typography.small,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  locationCode: {
    ...Typography.small,
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
    paddingHorizontal: Spacing.xl,
  },
});

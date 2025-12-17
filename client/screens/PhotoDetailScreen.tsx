import React from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HeaderButton } from "@react-navigation/elements";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { apiRequest, queryClient } from "@/lib/query-client";
import type { GalleryStackParamList } from "@/navigation/GalleryStackNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { Photo } from "@shared/schema";

type GalleryNavProp = NativeStackNavigationProp<GalleryStackParamList>;
type RootNavProp = NativeStackNavigationProp<RootStackParamList>;
type PhotoDetailRouteProp = RouteProp<GalleryStackParamList, "PhotoDetail">;

interface PhotoResponse {
  photo: Photo;
}

export default function PhotoDetailScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const galleryNav = useNavigation<GalleryNavProp>();
  const rootNav = useNavigation<RootNavProp>();
  const route = useRoute<PhotoDetailRouteProp>();
  const { photoId } = route.params;

  const { data, isLoading } = useQuery<PhotoResponse>({
    queryKey: ["/api/photos", photoId],
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/photos/${photoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      galleryNav.goBack();
    },
    onError: () => {
      Alert.alert("Error", "Failed to delete photo.");
    },
  });

  const photo = data?.photo;

  React.useLayoutEffect(() => {
    galleryNav.setOptions({
      headerRight: () => (
        <HeaderButton
          onPress={handleDelete}
          pressColor={theme.error}
        >
          <Feather name="trash-2" size={22} color={theme.error} />
        </HeaderButton>
      ),
    });
  }, [galleryNav, theme]);

  const handleDelete = () => {
    Alert.alert(
      "Delete Photo",
      "Are you sure you want to delete this photo? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ]
    );
  };

  const handleLink = () => {
    rootNav.navigate("LinkPhoto", { photoId });
  };

  if (isLoading || !photo) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.tabIconSelected} />
        </View>
      </ThemedView>
    );
  }

  const borderColor = photo.beforeAfter === "before" ? theme.warning : theme.success;
  const formattedDate = new Date(photo.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
        <View style={[styles.imageContainer, { backgroundColor: theme.cardBackground }]}>
          <View style={[styles.imageBorder, { borderColor }]}>
            <Image
              source={{ uri: photo.processedImageUrl }}
              style={styles.image}
              contentFit="contain"
            />
          </View>
        </View>

        <View style={styles.metadataContainer}>
          <View style={styles.metadataRow}>
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Initials
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{photo.initials}</ThemedText>
          </View>

          <View style={styles.metadataRow}>
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Type
            </ThemedText>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: photo.beforeAfter === "before" ? theme.warning : theme.success },
              ]}
            >
              <ThemedText style={styles.typeBadgeText}>
                {photo.beforeAfter === "before" ? "Before" : "After"}
              </ThemedText>
            </View>
          </View>

          <View style={styles.metadataRow}>
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Location Code
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{photo.locationCode}</ThemedText>
          </View>

          <View style={styles.metadataRow}>
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Date Saved
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{formattedDate}</ThemedText>
          </View>
        </View>

        {!photo.linkedPhotoId && (
          <Pressable
            style={({ pressed }) => [
              styles.linkButton,
              { backgroundColor: theme.tabIconSelected },
              pressed && styles.buttonPressed,
            ]}
            onPress={handleLink}
          >
            <Feather name="link" size={20} color="#FFFFFF" />
            <ThemedText style={styles.linkButtonText}>Link to Pair</ThemedText>
          </Pressable>
        )}

        {photo.linkedPhotoId && (
          <View style={[styles.linkedSection, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="check-circle" size={24} color={theme.success} />
            <ThemedText style={[styles.linkedText, { color: theme.textSecondary }]}>
              This photo is linked to a {photo.beforeAfter === "before" ? "After" : "Before"} photo
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xl,
  },
  imageContainer: {
    alignSelf: "center",
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  imageBorder: {
    borderWidth: 3,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  image: {
    width: 240,
    height: 300,
  },
  metadataContainer: {
    gap: Spacing.md,
  },
  metadataRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metadataLabel: {
    ...Typography.body,
  },
  metadataValue: {
    ...Typography.body,
    fontWeight: "600",
  },
  typeBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  typeBadgeText: {
    ...Typography.small,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  linkButton: {
    flexDirection: "row",
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  linkButtonText: {
    ...Typography.button,
    color: "#FFFFFF",
  },
  linkedSection: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.md,
  },
  linkedText: {
    ...Typography.body,
    flex: 1,
  },
});

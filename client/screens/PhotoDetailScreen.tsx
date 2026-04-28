import React from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { apiRequest, queryClient } from "@/lib/query-client";
import { hapticFeedback } from "@/lib/haptics";
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
  const tabBarHeight = useBottomTabBarHeight();
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
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
      hapticFeedback.success();
      galleryNav.goBack();
    },
    onError: () => {
      hapticFeedback.error();
      Alert.alert("Error", "Failed to delete photo.");
    },
  });

  const photo = data?.photo;

  React.useLayoutEffect(() => {
    galleryNav.setOptions({
      headerRight: () => (
        <View style={{ paddingRight: Spacing.xl }}>
          <Pressable
            onPress={handleDelete}
            hitSlop={12}
            style={styles.headerAction}
          >
            <Feather name="trash-2" size={22} color={theme.error} />
          </Pressable>
        </View>
      ),
    });
  }, [galleryNav, theme]);

  const handleDelete = () => {
    hapticFeedback.warning();
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
    hapticFeedback.light();
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
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.imageWrapper}>
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={40}
              tint={isDark ? "dark" : "light"}
              style={[styles.imageContainer, { borderColor }]}
            >
              <Image
                source={{ uri: photo.processedImageUrl }}
                style={styles.image}
                contentFit="contain"
              />
              {(photo.gender || photo.ageRange) ? (
                <View style={styles.demographicOverlay}>
                  <ThemedText style={styles.demographicOverlayText}>
                    {photo.gender ? `${photo.gender.charAt(0)}` : ""}{photo.ageRange ? ` ${photo.ageRange}` : ""}
                  </ThemedText>
                </View>
              ) : null}
              {photo.weeksAfter !== null && photo.weeksAfter !== undefined ? (
                <View style={styles.weeksOverlay}>
                  <ThemedText style={styles.weeksOverlayText}>{photo.weeksAfter}W</ThemedText>
                </View>
              ) : null}
            </BlurView>
          ) : (
            <View
              style={[
                styles.imageContainer,
                { borderColor, backgroundColor: isDark ? "rgba(44, 44, 46, 0.9)" : "rgba(255, 255, 255, 0.9)" },
              ]}
            >
              <Image
                source={{ uri: photo.processedImageUrl }}
                style={styles.image}
                contentFit="contain"
              />
              {(photo.gender || photo.ageRange) ? (
                <View style={styles.demographicOverlay}>
                  <ThemedText style={styles.demographicOverlayText}>
                    {photo.gender ? `${photo.gender.charAt(0)}` : ""}{photo.ageRange ? ` ${photo.ageRange}` : ""}
                  </ThemedText>
                </View>
              ) : null}
              {photo.weeksAfter !== null && photo.weeksAfter !== undefined ? (
                <View style={styles.weeksOverlay}>
                  <ThemedText style={styles.weeksOverlayText}>{photo.weeksAfter}W</ThemedText>
                </View>
              ) : null}
            </View>
          )}
        </View>

        <GlassCard style={styles.metadataCard}>
          <View style={styles.metadataRow}>
            <Feather name="user" size={18} color={theme.textSecondary} />
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Initials
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{photo.initials}</ThemedText>
          </View>

          <View style={styles.metadataDivider} />

          <View style={styles.metadataRow}>
            <Feather name="tag" size={18} color={theme.textSecondary} />
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

          <View style={styles.metadataDivider} />

          <View style={styles.metadataRow}>
            <Feather name="map-pin" size={18} color={theme.textSecondary} />
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Location
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{photo.locationCode}</ThemedText>
          </View>

          <View style={styles.metadataDivider} />

          <View style={styles.metadataRow}>
            <Feather name="calendar" size={18} color={theme.textSecondary} />
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Date
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{formattedDate}</ThemedText>
          </View>

          {(photo.gender || photo.ageRange) ? (
            <>
              <View style={styles.metadataDivider} />
              <View style={styles.metadataRow}>
                <Feather name="info" size={18} color={theme.textSecondary} />
                <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                  Demographics
                </ThemedText>
                <ThemedText style={styles.metadataValue}>
                  {photo.gender ? `${photo.gender}` : ""}{photo.ageRange ? ` ${photo.ageRange}` : ""}
                </ThemedText>
              </View>
            </>
          ) : null}

          {photo.weeksAfter !== null && photo.weeksAfter !== undefined ? (
            <>
              <View style={styles.metadataDivider} />
              <View style={styles.metadataRow}>
                <Feather name="clock" size={18} color={theme.textSecondary} />
                <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                  Time Point
                </ThemedText>
                <ThemedText style={styles.metadataValue}>{photo.weeksAfter} Weeks After</ThemedText>
              </View>
            </>
          ) : null}
        </GlassCard>

        {!photo.linkedPhotoId ? (
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
        ) : null}

        {photo.linkedPhotoId ? (
          <GlassCard style={styles.linkedCard}>
            <View style={styles.linkedContent}>
              <Feather name="check-circle" size={24} color={theme.success} />
              <ThemedText style={[styles.linkedText, { color: theme.textSecondary }]}>
                Linked to {photo.beforeAfter === "before" ? "After" : "Before"} photo
              </ThemedText>
            </View>
          </GlassCard>
        ) : null}
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
    gap: Spacing.lg,
  },
  imageWrapper: {
    alignSelf: "center",
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  imageContainer: {
    borderWidth: 3,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    overflow: "hidden",
  },
  image: {
    width: 260,
    height: 340,
    borderRadius: BorderRadius.md,
  },
  demographicOverlay: {
    position: "absolute",
    bottom: Spacing.lg,
    left: Spacing.lg,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  demographicOverlayText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  weeksOverlay: {
    position: "absolute",
    bottom: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: "rgba(0, 122, 255, 0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  weeksOverlayText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  metadataCard: {
    gap: Spacing.md,
  },
  metadataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  metadataLabel: {
    flex: 1,
    ...Typography.body,
  },
  metadataValue: {
    ...Typography.body,
    fontWeight: "600",
  },
  metadataDivider: {
    height: 1,
    backgroundColor: "rgba(128, 128, 128, 0.2)",
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
    borderRadius: BorderRadius.md,
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
  linkedCard: {
    borderWidth: 1,
    borderColor: "rgba(52, 199, 89, 0.3)",
  },
  linkedContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  linkedText: {
    ...Typography.body,
    flex: 1,
  },
  headerAction: {
    minHeight: 32,
    minWidth: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});

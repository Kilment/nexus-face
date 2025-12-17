import React from "react";
import {
  View,
  StyleSheet,
  ScrollView,
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
import type { Photo } from "@shared/schema";

type NavigationProp = NativeStackNavigationProp<GalleryStackParamList>;
type LinkedPairRouteProp = RouteProp<GalleryStackParamList, "LinkedPair">;

interface PhotoResponse {
  photo: Photo;
}

export default function LinkedPairScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<LinkedPairRouteProp>();
  const { photoId, linkedPhotoId } = route.params;

  const { data: photo1Data, isLoading: isLoading1 } = useQuery<PhotoResponse>({
    queryKey: ["/api/photos", photoId],
  });

  const { data: photo2Data, isLoading: isLoading2 } = useQuery<PhotoResponse>({
    queryKey: ["/api/photos", linkedPhotoId],
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/photos/${photoId}/link`, { linkedPhotoId: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      navigation.goBack();
    },
    onError: () => {
      Alert.alert("Error", "Failed to unlink photos.");
    },
  });

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton
          onPress={handleUnlink}
          pressColor={theme.error}
        >
          <ThemedText style={{ color: theme.error }}>Unlink</ThemedText>
        </HeaderButton>
      ),
    });
  }, [navigation, theme]);

  const handleUnlink = () => {
    Alert.alert(
      "Unlink Photos",
      "Are you sure you want to unlink these photos?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: () => unlinkMutation.mutate(),
        },
      ]
    );
  };

  if (isLoading1 || isLoading2 || !photo1Data?.photo || !photo2Data?.photo) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.tabIconSelected} />
        </View>
      </ThemedView>
    );
  }

  const photo1 = photo1Data.photo;
  const photo2 = photo2Data.photo;

  const beforePhoto = photo1.beforeAfter === "before" ? photo1 : photo2;
  const afterPhoto = photo1.beforeAfter === "after" ? photo1 : photo2;

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
        <View style={styles.pairContainer}>
          <View style={styles.photoSection}>
            <ThemedText style={[styles.label, { color: theme.warning }]}>Before</ThemedText>
            <View style={[styles.imageContainer, { backgroundColor: theme.cardBackground, borderColor: theme.warning }]}>
              <Image
                source={{ uri: beforePhoto.processedImageUrl }}
                style={styles.image}
                contentFit="contain"
              />
            </View>
          </View>

          <View style={styles.arrowContainer}>
            <Feather name="arrow-down" size={32} color={theme.textSecondary} />
          </View>

          <View style={styles.photoSection}>
            <ThemedText style={[styles.label, { color: theme.success }]}>After</ThemedText>
            <View style={[styles.imageContainer, { backgroundColor: theme.cardBackground, borderColor: theme.success }]}>
              <Image
                source={{ uri: afterPhoto.processedImageUrl }}
                style={styles.image}
                contentFit="contain"
              />
            </View>
          </View>
        </View>

        <View style={[styles.metadataSection, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.metadataRow}>
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Initials
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{beforePhoto.initials}</ThemedText>
          </View>

          <View style={styles.metadataRow}>
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Location Code
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{beforePhoto.locationCode}</ThemedText>
          </View>
        </View>
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
  pairContainer: {
    alignItems: "center",
    gap: Spacing.md,
  },
  photoSection: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  label: {
    ...Typography.h3,
    fontWeight: "700",
  },
  imageContainer: {
    borderWidth: 3,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    overflow: "hidden",
  },
  image: {
    width: 180,
    height: 220,
  },
  arrowContainer: {
    paddingVertical: Spacing.xs,
  },
  metadataSection: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
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
});

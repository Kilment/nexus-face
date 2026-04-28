import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  Text,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "@tanstack/react-query";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { apiRequest, queryClient } from "@/lib/query-client";
import { hapticFeedback } from "@/lib/haptics";
import type { GalleryStackParamList } from "@/navigation/GalleryStackNavigator";
import type { Photo } from "@shared/schema";
import { PhotoLightboxModal } from "@/components/PhotoLightboxModal";

type NavigationProp = NativeStackNavigationProp<GalleryStackParamList>;
type LinkedPairRouteProp = RouteProp<GalleryStackParamList, "LinkedPair">;

interface PhotoResponse {
  photo: Photo;
}

interface PairAnalysisResponse {
  analysis: {
    studyId: string;
    metrics: {
      deltaPredictedFacialAge: number;
      deltaSubclinicalWrinkles: number;
      deltaWrinkles: number;
      perceivedSkinFirmnessDelta: number;
      perceivedDensityDelta: number;
      perceivedFacialFullnessDelta: number;
      perceivedGonialAngleDelta: number;
      confidence?: number;
    };
  };
}
interface PairAnalysisStatusResponse {
  linked: boolean;
  studyId: string | null;
  hasAnalysis: boolean;
  status: {
    state: "idle" | "running" | "complete" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    analysisCount: number;
  };
}

type MetricKey =
  | "deltaPredictedFacialAge"
  | "deltaSubclinicalWrinkles"
  | "deltaWrinkles"
  | "perceivedSkinFirmnessDelta"
  | "perceivedDensityDelta"
  | "perceivedFacialFullnessDelta"
  | "perceivedGonialAngleDelta";

interface MetricDescriptor {
  key: MetricKey;
  title: string;
  shortLabel: string;
  unit: string;
  digits: number;
  betterWhen: "lower" | "higher";
  description: string;
}

const METRIC_DESCRIPTORS: MetricDescriptor[] = [
  {
    key: "deltaPredictedFacialAge",
    title: "Predicted Facial Age Change",
    shortLabel: "Age",
    unit: "Years",
    digits: 1,
    betterWhen: "lower",
    description: "Negative values indicate a younger perceived facial age versus baseline.",
  },
  {
    key: "deltaSubclinicalWrinkles",
    title: "Subclinical Wrinkles Change",
    shortLabel: "Subclinical Wrinkles",
    unit: "Points",
    digits: 1,
    betterWhen: "lower",
    description: "Tracks subtle wrinkle texture changes that may not be obvious at first glance.",
  },
  {
    key: "deltaWrinkles",
    title: "Wrinkles Change",
    shortLabel: "Wrinkles",
    unit: "Points",
    digits: 1,
    betterWhen: "lower",
    description: "Measures visible wrinkle severity difference between before and after.",
  },
  {
    key: "perceivedSkinFirmnessDelta",
    title: "Perceived Skin Firmness Change",
    shortLabel: "Firmness",
    unit: "Points",
    digits: 1,
    betterWhen: "higher",
    description: "Higher values indicate stronger perceived skin support and tension.",
  },
  {
    key: "perceivedDensityDelta",
    title: "Perceived Density Change",
    shortLabel: "Density",
    unit: "Points",
    digits: 1,
    betterWhen: "higher",
    description: "Reflects perceived dermal density and structural skin richness.",
  },
  {
    key: "perceivedFacialFullnessDelta",
    title: "Perceived Facial Fullness Change",
    shortLabel: "Fullness",
    unit: "Points",
    digits: 1,
    betterWhen: "higher",
    description: "Higher values suggest improved fullness in age-sensitive facial areas.",
  },
  {
    key: "perceivedGonialAngleDelta",
    title: "Perceived Gonial Angle Change",
    shortLabel: "Gonial Angle",
    unit: "Degrees",
    digits: 2,
    betterWhen: "higher",
    description: "Geometric jawline proxy based on landmark-derived angle shift.",
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const COMPARISON_IMAGE_SIZE = (SCREEN_WIDTH - Spacing.lg * 3) / 2;

type ViewMode = "side-by-side" | "stacked" | "slider";

export default function LinkedPairScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const appNavigation = useNavigation<any>();
  const route = useRoute<LinkedPairRouteProp>();
  const { photoId, linkedPhotoId } = route.params;

  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [activeMetric, setActiveMetric] = useState<MetricKey>("deltaPredictedFacialAge");
  const [activePhotoUri, setActivePhotoUri] = useState<string | null>(null);
  const sliderPosition = useSharedValue(0.5);

  const sliderStyle = useAnimatedStyle(() => ({
    left: `${sliderPosition.value * 100}%`,
  }));

  const afterOverlayStyle = useAnimatedStyle(() => ({
    width: `${sliderPosition.value * 100}%`,
  }));

  const { data: photo1Data, isLoading: isLoading1 } = useQuery<PhotoResponse>({
    queryKey: ["/api/photos", photoId],
  });

  const { data: photo2Data, isLoading: isLoading2 } = useQuery<PhotoResponse>({
    queryKey: ["/api/photos", linkedPhotoId],
  });

  const { data: pairAnalysisData } = useQuery<PairAnalysisResponse>({
    queryKey: ["/api/photos", photoId, "pair-analysis"],
    retry: false,
  });
  const { data: pairStatusData } = useQuery<PairAnalysisStatusResponse>({
    queryKey: ["/api/photos", photoId, "pair-analysis-status"],
    refetchInterval: (query) =>
      query.state.data?.status?.state === "running" ? 3000 : false,
    retry: false,
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/photos/${photoId}/link`, { linkedPhotoId: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      hapticFeedback.success();
      navigation.goBack();
    },
    onError: () => {
      hapticFeedback.error();
      Alert.alert("Error", "Failed to unlink photos.");
    },
  });

  const convertToStudyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/photos/${photoId}/convert-to-study`);
      return (await res.json()) as { study: { id: string } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/photos", photoId, "pair-analysis"] });
      hapticFeedback.success();
      appNavigation.navigate("Main", {
        screen: "ProfileTab",
        params: {
          screen: "StudyDetail",
          params: { studyId: data.study.id, entryPoint: "pairs" },
        },
      });
    },
    onError: () => {
      hapticFeedback.error();
      Alert.alert("Conversion Failed", "Unable To Open Cohort Study.");
    },
  });

  const handleUnlink = useCallback(() => {
    hapticFeedback.warning();
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
  }, [unlinkMutation]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleUnlink}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerNavBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Unlink paired photos"
        >
          <Text style={[styles.headerNavLabelText, { color: theme.error }]}>Unlink</Text>
        </Pressable>
      ),
    });
  }, [navigation, theme, handleUnlink]);

  const cycleViewMode = () => {
    hapticFeedback.selection();
    const modes: ViewMode[] = ["side-by-side", "stacked", "slider"];
    const currentIndex = modes.indexOf(viewMode);
    setViewMode(modes[(currentIndex + 1) % modes.length]);
  };
  const getModeLabel = (mode: ViewMode) =>
    mode === "side-by-side" ? "Paired" : mode === "stacked" ? "Stacked" : "Slider";
  const getModeIcon = (mode: ViewMode): keyof typeof Feather.glyphMap =>
    mode === "side-by-side" ? "columns" : mode === "stacked" ? "layers" : "sliders";
  const getNextViewMode = (mode: ViewMode): ViewMode => {
    const modes: ViewMode[] = ["side-by-side", "stacked", "slider"];
    const currentIndex = modes.indexOf(mode);
    return modes[(currentIndex + 1) % modes.length];
  };
  const nextViewMode = getNextViewMode(viewMode);
  const openPhotoPreview = (uri: string) => {
    hapticFeedback.light();
    setActivePhotoUri(uri);
  };

  const metrics = pairAnalysisData?.analysis?.metrics;
  const studyId = pairAnalysisData?.analysis?.studyId ?? pairStatusData?.studyId ?? null;
  const hasCohortAnalysis = Boolean(studyId);
  const analysisState = pairStatusData?.status?.state ?? "idle";
  const analysisStateText =
    analysisState === "running"
      ? "Analysis Running In Background"
      : analysisState === "failed"
        ? "Analysis Failed"
        : analysisState === "complete"
          ? "Analysis Complete"
          : "Analysis Pending";

  React.useEffect(() => {
    if (!metrics) return;
    setActiveMetric((current) => {
      const exists = METRIC_DESCRIPTORS.some((descriptor) => descriptor.key === current);
      return exists ? current : "deltaPredictedFacialAge";
    });
  }, [metrics]);

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

  const signed = (value: number, digits = 1) =>
    `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

  const activeDescriptor = METRIC_DESCRIPTORS.find((descriptor) => descriptor.key === activeMetric);
  const activeValue = activeDescriptor && metrics ? metrics[activeDescriptor.key] : 0;
  const activeIsPositive = activeValue > 0;
  const activeDirectionText = activeDescriptor
    ? activeDescriptor.betterWhen === "lower"
      ? activeValue < 0
        ? "Improved"
        : activeValue > 0
          ? "Worsened"
          : "No Change"
      : activeValue > 0
        ? "Improved"
        : activeValue < 0
          ? "Worsened"
          : "No Change"
    : "No Change";
  const activeDirectionColor =
    activeDirectionText === "Improved"
      ? theme.success
      : activeDirectionText === "Worsened"
        ? theme.error
        : theme.textSecondary;
  const activeMagnitudeWidth = `${Math.min(Math.abs(activeValue) * 20, 100)}%` as `${number}%`;

  const renderSideBySide = () => (
    <View style={styles.sideBySideContainer}>
      <View style={styles.comparisonColumn}>
        <View style={styles.labelContainer}>
          {Platform.OS === "ios" ? (
            <BlurView intensity={60} tint={isDark ? "dark" : "light"} style={[styles.labelBadge, { borderColor: theme.warning }]}>
              <ThemedText style={[styles.labelText, { color: theme.warning }]}>Before</ThemedText>
            </BlurView>
          ) : (
            <View style={[styles.labelBadge, styles.labelBadgeFallback, { borderColor: theme.warning, backgroundColor: isDark ? "rgba(90, 200, 250, 0.15)" : "rgba(90, 200, 250, 0.1)" }]}>
              <ThemedText style={[styles.labelText, { color: theme.warning }]}>Before</ThemedText>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => openPhotoPreview(beforePhoto.processedImageUrl)}
          accessibilityRole="button"
          accessibilityLabel="View before photo full screen"
        >
          <View style={[styles.comparisonImage, { borderColor: theme.warning }]}>
            <Image
              source={{ uri: beforePhoto.processedImageUrl }}
              style={styles.image}
              contentFit="cover"
            />
          </View>
        </Pressable>
      </View>

      <View style={styles.comparisonColumn}>
        <View style={styles.labelContainer}>
          {Platform.OS === "ios" ? (
            <BlurView intensity={60} tint={isDark ? "dark" : "light"} style={[styles.labelBadge, { borderColor: theme.success }]}>
              <ThemedText style={[styles.labelText, { color: theme.success }]}>After</ThemedText>
            </BlurView>
          ) : (
            <View style={[styles.labelBadge, styles.labelBadgeFallback, { borderColor: theme.success, backgroundColor: isDark ? "rgba(52, 199, 89, 0.15)" : "rgba(52, 199, 89, 0.1)" }]}>
              <ThemedText style={[styles.labelText, { color: theme.success }]}>After</ThemedText>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => openPhotoPreview(afterPhoto.processedImageUrl)}
          accessibilityRole="button"
          accessibilityLabel="View after photo full screen"
        >
          <View style={[styles.comparisonImage, { borderColor: theme.success }]}>
            <Image
              source={{ uri: afterPhoto.processedImageUrl }}
              style={styles.image}
              contentFit="cover"
            />
          </View>
        </Pressable>
      </View>
    </View>
  );

  const renderStacked = () => (
    <View style={styles.stackedContainer}>
      <Pressable
        onPress={() => openPhotoPreview(beforePhoto.processedImageUrl)}
        accessibilityRole="button"
        accessibilityLabel="View before photo full screen"
      >
        <View style={[styles.stackedImageContainer, { borderColor: theme.warning }]}>
          <ThemedText style={[styles.stackedLabel, { color: theme.warning }]}>Before</ThemedText>
          <Image
            source={{ uri: beforePhoto.processedImageUrl }}
            style={styles.stackedImage}
            contentFit="cover"
          />
        </View>
      </Pressable>

      <View style={styles.stackedArrow}>
        <Feather name="arrow-down" size={28} color={theme.tabIconSelected} />
      </View>

      <Pressable
        onPress={() => openPhotoPreview(afterPhoto.processedImageUrl)}
        accessibilityRole="button"
        accessibilityLabel="View after photo full screen"
      >
        <View style={[styles.stackedImageContainer, { borderColor: theme.success }]}>
          <ThemedText style={[styles.stackedLabel, { color: theme.success }]}>After</ThemedText>
          <Image
            source={{ uri: afterPhoto.processedImageUrl }}
            style={styles.stackedImage}
            contentFit="cover"
          />
        </View>
      </Pressable>
    </View>
  );

  const renderSlider = () => (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderImageWrapper}>
        <Image
          source={{ uri: beforePhoto.processedImageUrl }}
          style={styles.sliderImage}
          contentFit="cover"
        />
        <Animated.View style={[styles.sliderOverlay, afterOverlayStyle]}>
          <Image
            source={{ uri: afterPhoto.processedImageUrl }}
            style={[styles.sliderImage, { position: "absolute", left: 0 }]}
            contentFit="cover"
          />
        </Animated.View>
        <Animated.View style={[styles.sliderHandle, sliderStyle]}>
          <View style={[styles.sliderHandleBar, { backgroundColor: theme.tabIconSelected }]} />
        </Animated.View>
      </View>
      <View style={styles.sliderLabels}>
        <ThemedText style={[styles.sliderLabel, { color: theme.warning }]}>Before</ThemedText>
        <ThemedText style={[styles.sliderLabel, { color: theme.success }]}>After</ThemedText>
      </View>
    </View>
  );

  return (
    <>
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: headerHeight + Spacing.lg,
              paddingBottom: tabBarHeight + Spacing.xl,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.viewModeToggle}>
          <Pressable onPress={cycleViewMode} style={styles.viewModeButton}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={50} tint={isDark ? "dark" : "light"} style={styles.viewModeBlur}>
                <Feather
                  name={getModeIcon(nextViewMode)}
                  size={18}
                  color={theme.tabIconSelected}
                />
                <ThemedText style={[styles.viewModeText, { color: theme.tabIconSelected }]}>
                  {getModeLabel(nextViewMode)}
                </ThemedText>
              </BlurView>
            ) : (
              <View style={[styles.viewModeBlur, { backgroundColor: isDark ? "rgba(60, 60, 67, 0.5)" : "rgba(120, 120, 128, 0.2)" }]}>
                <Feather
                  name={getModeIcon(nextViewMode)}
                  size={18}
                  color={theme.tabIconSelected}
                />
                <ThemedText style={[styles.viewModeText, { color: theme.tabIconSelected }]}>
                  {getModeLabel(nextViewMode)}
                </ThemedText>
              </View>
            )}
          </Pressable>
        </View>

        {viewMode === "side-by-side" ? renderSideBySide() : null}
        {viewMode === "stacked" ? renderStacked() : null}
        {viewMode === "slider" ? renderSlider() : null}

        {metrics ? (
          <GlassCard style={styles.resultsCard}>
            <View style={styles.resultsHeader}>
              <ThemedText style={[styles.resultsEyebrow, { color: theme.textSecondary }]}>
                Pair Analysis Results
              </ThemedText>
              <ThemedText style={[styles.resultsHeadline, { color: theme.tabIconSelected }]}>
                ΔAge {signed(metrics.deltaPredictedFacialAge)}Y
              </ThemedText>
              <ThemedText style={[styles.resultsSubhead, { color: theme.textTertiary }]}>
                Tap Metrics
              </ThemedText>
            </View>

            <View style={styles.metricChipGrid}>
              {METRIC_DESCRIPTORS.map((descriptor) => {
                const value = metrics[descriptor.key];
                const selected = descriptor.key === activeMetric;
                return (
                  <Pressable
                    key={descriptor.key}
                    onPress={() => setActiveMetric(descriptor.key)}
                    style={[
                      styles.metricChip,
                      {
                        borderColor: selected ? theme.tabIconSelected : "rgba(128, 128, 128, 0.2)",
                        backgroundColor: selected
                          ? isDark
                            ? "rgba(10, 132, 255, 0.18)"
                            : "rgba(0, 122, 255, 0.12)"
                          : "transparent",
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.metricChipLabel,
                        { color: selected ? theme.tabIconSelected : theme.textSecondary },
                      ]}
                    >
                      {descriptor.shortLabel}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.metricChipValue,
                        { color: selected ? theme.text : theme.textSecondary },
                      ]}
                    >
                      {signed(value, descriptor.digits)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {activeDescriptor ? (
              <View style={[styles.metricDetailCard, { borderColor: "rgba(128, 128, 128, 0.2)" }]}>
                <View style={styles.metricDetailTopRow}>
                  <ThemedText style={styles.metricDetailTitle}>{activeDescriptor.title}</ThemedText>
                  <ThemedText style={[styles.metricDirection, { color: activeDirectionColor }]}>
                    {activeDirectionText}
                  </ThemedText>
                </View>

                <ThemedText style={[styles.metricDetailValue, { color: theme.text }]}>
                  {signed(activeValue, activeDescriptor.digits)} {activeDescriptor.unit}
                </ThemedText>

                <View style={[styles.magnitudeTrack, { backgroundColor: "rgba(128, 128, 128, 0.25)" }]}>
                  <View
                    style={[
                      styles.magnitudeFill,
                      {
                        width: activeMagnitudeWidth,
                        backgroundColor: activeDirectionColor,
                      },
                    ]}
                  />
                </View>

                <ThemedText style={[styles.metricDetailDescription, { color: theme.textSecondary }]}>
                  {activeDescriptor.description}
                </ThemedText>
              </View>
            ) : null}
          </GlassCard>
        ) : null}

        {!metrics ? (
          <GlassCard style={styles.analysisStatusCard}>
            <View style={styles.analysisStatusRow}>
              <ActivityIndicator
                size="small"
                color={analysisState === "failed" ? theme.error : theme.tabIconSelected}
              />
              <ThemedText
                style={[
                  styles.analysisStatusText,
                  { color: analysisState === "failed" ? theme.error : theme.textSecondary },
                ]}
              >
                {analysisStateText}
              </ThemedText>
            </View>
          </GlassCard>
        ) : null}

        <GlassButton
          title={
            analysisState === "running"
              ? "Analysis Running…"
              : hasCohortAnalysis
              ? "Add More Photos"
              : convertToStudyMutation.isPending
                ? "Adding More Photos…"
                : "Add More Photos"
          }
          icon="layers"
          loading={convertToStudyMutation.isPending || analysisState === "running"}
          disabled={convertToStudyMutation.isPending || analysisState === "running"}
          onPress={() => {
            hapticFeedback.medium();
            if (studyId) {
              appNavigation.navigate("Main", {
                screen: "ProfileTab",
                params: {
                  screen: "StudyDetail",
                  params: { studyId, entryPoint: "pairs" },
                },
              });
              return;
            }
            convertToStudyMutation.mutate();
          }}
        />

        <GlassCard style={styles.metadataCard}>
          <View style={styles.metadataRow}>
            <Feather name="user" size={18} color={theme.textSecondary} />
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Initials
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{beforePhoto.initials}</ThemedText>
          </View>

          <View style={styles.metadataDivider} />

          <View style={styles.metadataRow}>
            <Feather name="map-pin" size={18} color={theme.textSecondary} />
            <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
              Location
            </ThemedText>
            <ThemedText style={styles.metadataValue}>{beforePhoto.locationCode}</ThemedText>
          </View>

          {beforePhoto.gender || beforePhoto.ageRange || beforePhoto.ethnicity ? (
            <>
              <View style={styles.metadataDivider} />
              <View style={styles.metadataRow}>
                <Feather name="info" size={18} color={theme.textSecondary} />
                <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                  Demographics
                </ThemedText>
                <ThemedText style={styles.metadataValue}>
                  {beforePhoto.gender ? `${beforePhoto.gender.charAt(0)}` : ""}{beforePhoto.ageRange ? ` ${beforePhoto.ageRange}` : ""}{beforePhoto.ethnicity ? ` ${beforePhoto.ethnicity}` : ""}
                </ThemedText>
              </View>
            </>
          ) : null}

          {afterPhoto.weeksAfter !== null && afterPhoto.weeksAfter !== undefined ? (
            <>
              <View style={styles.metadataDivider} />
              <View style={styles.metadataRow}>
                <Feather name="calendar" size={18} color={theme.textSecondary} />
                <ThemedText style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                  Time Point
                </ThemedText>
                <ThemedText style={styles.metadataValue}>{afterPhoto.weeksAfter} Weeks</ThemedText>
              </View>
            </>
          ) : null}
        </GlassCard>
        </ScrollView>
      </ThemedView>
      <PhotoLightboxModal uri={activePhotoUri} onClose={() => setActivePhotoUri(null)} />
    </>
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
  viewModeToggle: {
    alignItems: "center",
  },
  viewModeButton: {
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  viewModeBlur: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  viewModeText: {
    fontSize: 14,
    fontWeight: "600",
  },
  sideBySideContainer: {
    flexDirection: "row",
    gap: Spacing.lg,
    justifyContent: "center",
  },
  comparisonColumn: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  labelContainer: {
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  labelBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1.5,
    borderRadius: BorderRadius.full,
  },
  labelBadgeFallback: {
    overflow: "hidden",
  },
  labelText: {
    fontSize: 14,
    fontWeight: "600",
  },
  comparisonImage: {
    width: COMPARISON_IMAGE_SIZE,
    height: COMPARISON_IMAGE_SIZE * 1.3,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  stackedContainer: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  stackedImageContainer: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    height: (SCREEN_WIDTH - Spacing.lg * 2) * 0.7,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    overflow: "hidden",
    position: "relative",
  },
  stackedLabel: {
    position: "absolute",
    top: Spacing.sm,
    left: Spacing.sm,
    fontSize: 14,
    fontWeight: "700",
    zIndex: 1,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  stackedImage: {
    width: "100%",
    height: "100%",
  },
  stackedArrow: {
    paddingVertical: Spacing.xs,
  },
  sliderContainer: {
    gap: Spacing.sm,
  },
  sliderImageWrapper: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    height: (SCREEN_WIDTH - Spacing.lg * 2) * 1.2,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    position: "relative",
  },
  sliderImage: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    height: (SCREEN_WIDTH - Spacing.lg * 2) * 1.2,
  },
  sliderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    overflow: "hidden",
  },
  sliderHandle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 4,
    marginLeft: -2,
    justifyContent: "center",
  },
  sliderHandleBar: {
    width: 4,
    height: "100%",
    borderRadius: 2,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.sm,
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  resultsCard: {
    gap: Spacing.xl,
    marginTop: Spacing.sm,
    padding: Spacing.lg,
  },
  resultsHeader: {
    alignItems: "center",
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  resultsEyebrow: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "600",
  },
  resultsHeadline: {
    fontSize: 38,
    fontWeight: "800",
    lineHeight: 42,
  },
  resultsSubhead: {
    fontSize: 13,
    fontWeight: "600",
  },
  metricChipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  metricChip: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    width: "48%",
    minHeight: 72,
    gap: Spacing.xs,
    justifyContent: "center",
  },
  metricChipLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  metricChipValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  metricDetailCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  metricDetailTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
  },
  metricDetailTitle: {
    ...Typography.body,
    fontWeight: "600",
    flex: 1,
  },
  metricDirection: {
    ...Typography.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  metricDetailValue: {
    fontSize: 28,
    fontWeight: "800",
    marginTop: Spacing.xs,
  },
  magnitudeTrack: {
    height: 8,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  magnitudeFill: {
    height: "100%",
    borderRadius: BorderRadius.full,
  },
  metricDetailDescription: {
    ...Typography.small,
    lineHeight: 18,
    marginTop: Spacing.xs,
  },
  analysisStatusCard: {
    padding: Spacing.md,
  },
  analysisStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  analysisStatusText: {
    ...Typography.small,
    fontWeight: "600",
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
  /** Symmetric padding only; iOS 26 liquid-glass capsule sizes around shrink-wrapped Text. */
  headerNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerNavLabelText: {
    fontSize: 17,
    fontWeight: "600",
  },
});

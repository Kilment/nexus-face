import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, StyleSheet, Alert, Dimensions, Platform, BackHandler } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { useNavigation, useRoute, RouteProp, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import { hapticFeedback } from "@/lib/haptics";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { base64ToDataUri } from "@/lib/base64-data-uri";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ProcessingRouteProp = RouteProp<RootStackParamList, "Processing">;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const IMAGE_WIDTH = SCREEN_WIDTH * 0.65;
const IMAGE_HEIGHT = IMAGE_WIDTH * 1.35;

export default function ProcessingScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ProcessingRouteProp>();
  const { imageBase64 } = route.params;
  const previewUri = useMemo(() => base64ToDataUri(imageBase64), [imageBase64]);

  const [status, setStatus] = useState("Detecting face...");
  const [isComplete, setIsComplete] = useState(false);
  const [isProcessing, setIsProcessing] = useState(true);
  const [progress, setProgress] = useState(0);

  const scanLinePosition = useSharedValue(0);
  /** Full height from mount so oval shows the preview (bright layer) immediately; avoids a black/dim oval before decode completes. */
  const revealHeight = useSharedValue(IMAGE_HEIGHT);
  const pulseOpacity = useSharedValue(0.3);
  const progressWidth = useSharedValue(0);
  const progressGlow = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (isProcessing) {
          return true;
        }
        return false;
      };

      BackHandler.addEventListener("hardwareBackPress", onBackPress);

      return () => {
        // @ts-ignore
        const bh = BackHandler as any;
        if (bh.removeEventListener) {
          bh.removeEventListener("hardwareBackPress", onBackPress);
        } else if (bh.remove) {
          bh.remove("hardwareBackPress", onBackPress);
        }
      };
    }, [isProcessing])
  );

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => null,
      gestureEnabled: false,
    });
  }, [navigation]);

  useEffect(() => {
    scanLinePosition.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false
    );

    pulseOpacity.value = withRepeat(
      withTiming(0.7, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    progressGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );

    processImage();
  }, []);

  const scanLineStyle = useAnimatedStyle(() => {
    if (isComplete) {
      return { opacity: 0 };
    }
    return {
      top: interpolate(scanLinePosition.value, [0, 1], [0, IMAGE_HEIGHT]),
      opacity: 1,
    };
  });

  const revealMaskStyle = useAnimatedStyle(() => ({
    height: revealHeight.value,
  }));

  const statusDotStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const progressGlowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progressGlow.value, [0, 1], [0.3, 0.8]),
  }));

  const updateProgress = (value: number) => {
    setProgress(value);
    progressWidth.value = withTiming(value, { duration: 300, easing: Easing.out(Easing.ease) });
  };

  const processImage = async () => {
    try {
      updateProgress(15);
      await new Promise((resolve) => setTimeout(resolve, 600));
      setStatus("Isolating face...");
      updateProgress(35);

      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus("Processing...");
      updateProgress(50);

      const response = await apiRequest("POST", "/api/photos/process", {
        imageBase64,
      });
      const data = await response.json();

      updateProgress(85);
      setStatus("Finalizing...");

      await new Promise((resolve) => setTimeout(resolve, 300));
      updateProgress(100);
      setIsComplete(true);
      setIsProcessing(false);
      setStatus("Complete!");
      hapticFeedback.success();

      await new Promise((resolve) => setTimeout(resolve, 800));

      navigation.replace("Tagging", {
        processedImageBase64: data.processedImageBase64,
      });
    } catch (error) {
      console.error("Processing error:", error);
      setIsProcessing(false);
      hapticFeedback.error();
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to process the image. Please try again.";
      Alert.alert(
        "Processing Failed",
        message,
        [
          {
            text: "OK",
            onPress: () => navigation.goBack(),
          },
        ]
      );
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.imageWrapper}>
          <View style={[styles.imageContainer, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }]}>
            <Image
              source={{ uri: previewUri }}
              style={styles.previewImage}
              contentFit="cover"
            />
            <View style={styles.darkOverlay} />

            <Animated.View style={[styles.revealContainer, revealMaskStyle]}>
              <Image
                source={{ uri: previewUri }}
                style={[styles.previewImage, { height: IMAGE_HEIGHT }]}
                contentFit="cover"
              />
            </Animated.View>

            {!isComplete ? (
              <Animated.View
                style={[
                  styles.scanLine,
                  scanLineStyle,
                  { backgroundColor: theme.tabIconSelected },
                ]}
              />
            ) : null}

            <View style={[styles.ovalBorder, { borderColor: theme.tabIconSelected }]} />
          </View>
        </View>

        <View style={styles.progressSection}>
          <View style={styles.progressContainer}>
            {Platform.OS === "ios" ? (
              <BlurView
                intensity={40}
                tint={isDark ? "dark" : "light"}
                style={styles.progressBackground}
              >
                <Animated.View
                  style={[
                    styles.progressBar,
                    progressBarStyle,
                    { backgroundColor: theme.tabIconSelected },
                  ]}
                >
                  <Animated.View
                    style={[styles.progressGlow, progressGlowStyle]}
                  />
                </Animated.View>
              </BlurView>
            ) : (
              <View
                style={[
                  styles.progressBackground,
                  {
                    backgroundColor: isDark
                      ? "rgba(60, 60, 67, 0.5)"
                      : "rgba(120, 120, 128, 0.2)",
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.progressBar,
                    progressBarStyle,
                    { backgroundColor: theme.tabIconSelected },
                  ]}
                >
                  <Animated.View
                    style={[styles.progressGlow, progressGlowStyle]}
                  />
                </Animated.View>
              </View>
            )}
          </View>
          <ThemedText style={[styles.progressText, { color: theme.textSecondary }]}>
            {progress}%
          </ThemedText>
        </View>

        <View style={styles.statusContainer}>
          <View style={styles.statusIndicator}>
            <Animated.View
              style={[
                styles.statusDot,
                { backgroundColor: isComplete ? theme.success : theme.tabIconSelected },
                statusDotStyle,
              ]}
            />
            <ThemedText style={styles.statusText}>{status}</ThemedText>
          </View>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  imageWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  imageContainer: {
    borderRadius: 9999,
    overflow: "hidden",
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
  },
  revealContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  ovalBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 9999,
    borderWidth: 3,
  },
  progressSection: {
    marginTop: Spacing.xl * 1.5,
    alignItems: "center",
    width: "100%",
    maxWidth: IMAGE_WIDTH,
  },
  progressContainer: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBackground: {
    flex: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
  },
  progressGlow: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 40,
    height: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  progressText: {
    marginTop: Spacing.sm,
    fontSize: 14,
    fontWeight: "600",
  },
  statusContainer: {
    marginTop: Spacing.xl,
    alignItems: "center",
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 17,
    fontWeight: "500",
    textAlign: "center",
  },
});

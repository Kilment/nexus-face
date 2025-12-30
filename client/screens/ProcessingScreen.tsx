import React, { useEffect, useState } from "react";
import { View, StyleSheet, Alert, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ProcessingRouteProp = RouteProp<RootStackParamList, "Processing">;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const IMAGE_WIDTH = SCREEN_WIDTH * 0.7;
const IMAGE_HEIGHT = IMAGE_WIDTH * 1.35;

export default function ProcessingScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ProcessingRouteProp>();
  const { imageBase64 } = route.params;
  
  const [status, setStatus] = useState("Detecting face...");
  const [isComplete, setIsComplete] = useState(false);

  const scanLinePosition = useSharedValue(0);
  const revealHeight = useSharedValue(0);
  const pulseOpacity = useSharedValue(0.3);

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

  const processImage = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setStatus("Isolating face...");
      
      await new Promise((resolve) => setTimeout(resolve, 600));
      setStatus("Processing...");

      const response = await apiRequest("POST", "/api/photos/process", {
        imageBase64,
      });
      const data = await response.json();

      setIsComplete(true);
      revealHeight.value = withTiming(IMAGE_HEIGHT, { duration: 800, easing: Easing.out(Easing.ease) });
      setStatus("Complete!");

      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      navigation.replace("Tagging", {
        processedImageBase64: data.processedImageBase64,
      });
    } catch (error) {
      console.error("Processing error:", error);
      Alert.alert(
        "Processing Failed",
        "Unable to process the image. Please try again.",
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
            {/* Base image with dark overlay */}
            <Image
              source={{ uri: `data:image/jpeg;base64,${imageBase64}` }}
              style={styles.previewImage}
              contentFit="cover"
            />
            <View style={styles.darkOverlay} />

            {/* Top-down reveal mask showing the bright image */}
            <Animated.View style={[styles.revealContainer, revealMaskStyle]}>
              <Image
                source={{ uri: `data:image/jpeg;base64,${imageBase64}` }}
                style={[styles.previewImage, { height: IMAGE_HEIGHT }]}
                contentFit="cover"
              />
            </Animated.View>

            {/* Scanning line */}
            {!isComplete ? (
              <Animated.View 
                style={[
                  styles.scanLine, 
                  scanLineStyle, 
                  { backgroundColor: theme.tabIconSelected }
                ]} 
              />
            ) : null}
            
            {/* Oval border */}
            <View style={[styles.ovalBorder, { borderColor: theme.tabIconSelected }]} />
          </View>
        </View>

        <View style={styles.statusContainer}>
          <View style={styles.statusIndicator}>
            <Animated.View 
              style={[
                styles.statusDot, 
                { backgroundColor: theme.tabIconSelected },
                statusDotStyle
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
    backgroundColor: "rgba(0, 0, 0, 0.5)",
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
  statusContainer: {
    marginTop: Spacing.xl * 2,
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

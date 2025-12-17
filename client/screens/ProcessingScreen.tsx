import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ProcessingRouteProp = RouteProp<RootStackParamList, "Processing">;

export default function ProcessingScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ProcessingRouteProp>();
  const { imageBase64 } = route.params;
  
  const [status, setStatus] = useState("Analyzing image...");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    processImage();
  }, []);

  const processImage = async () => {
    try {
      setStatus("Removing background...");
      setProgress(25);
      
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus("Isolating face...");
      setProgress(50);
      
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus("Processing with AI...");
      setProgress(75);

      const response = await apiRequest("POST", "/api/photos/process", {
        imageBase64,
      });
      const data = await response.json();

      setStatus("Processing complete!");
      setProgress(100);

      await new Promise((resolve) => setTimeout(resolve, 300));
      
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
            paddingTop: Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: `data:image/jpeg;base64,${imageBase64}` }}
            style={styles.previewImage}
            contentFit="cover"
          />
          <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.5)" }]} />
        </View>

        <View style={styles.statusContainer}>
          <ActivityIndicator size="large" color={theme.tabIconSelected} />
          <ThemedText style={styles.statusText}>{status}</ThemedText>
          <View style={[styles.progressBar, { backgroundColor: theme.backgroundSecondary }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: theme.tabIconSelected,
                  width: `${progress}%`,
                },
              ]}
            />
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
  imageContainer: {
    width: 200,
    height: 200,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    marginBottom: Spacing.xl,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  statusContainer: {
    alignItems: "center",
    gap: Spacing.md,
    width: "100%",
  },
  statusText: {
    fontSize: 17,
    fontWeight: "500",
    textAlign: "center",
  },
  progressBar: {
    width: "80%",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
});

import React, { useState, useRef, useEffect } from "react";
import { View, StyleSheet, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [facing, setFacing] = useState<CameraType>("front");
  const [flash, setFlash] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const toggleFacing = () => {
    setFacing((current) => (current === "back" ? "front" : "back"));
  };

  const toggleFlash = () => {
    setFlash((current) => !current);
  };

  const takePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.5,
      });

      if (photo?.base64) {
        // Navigate to Processing with the captured image
        navigation.navigate("Processing", { imageBase64: photo.base64 });
      }
    } catch (error) {
      console.error("Error taking photo:", error);
      Alert.alert("Error", "Failed to capture photo. Please try again.");
    } finally {
      setIsCapturing(false);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0]?.base64) {
        navigation.navigate("Processing", { imageBase64: result.assets[0].base64 });
      }
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert("Error", "Failed to pick image. Please try again.");
    }
  };

  if (!permission) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.permissionContainer}>
          <ThemedText>Loading camera...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.permissionContainer,
            {
              paddingTop: insets.top + Spacing.xl,
              paddingBottom: tabBarHeight + Spacing.xl,
            },
          ]}
        >
          <Feather name="camera-off" size={64} color={theme.textSecondary} />
          <ThemedText style={styles.permissionTitle}>Camera Access Required</ThemedText>
          <ThemedText style={[styles.permissionText, { color: theme.textSecondary }]}>
            FaceSnap needs camera access to capture and process photos.
          </ThemedText>
          <Pressable
            style={({ pressed }) => [
              styles.permissionButton,
              { backgroundColor: theme.tabIconSelected },
              pressed && styles.buttonPressed,
            ]}
            onPress={requestPermission}
          >
            <ThemedText style={styles.permissionButtonText}>Enable Camera</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.uploadButton,
              { borderColor: theme.border },
              pressed && styles.buttonPressed,
            ]}
            onPress={pickImage}
          >
            <Feather name="upload" size={20} color={theme.tabIconSelected} />
            <ThemedText style={[styles.uploadButtonText, { color: theme.tabIconSelected }]}>
              Upload from Library
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  if (Platform.OS === "web") {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.permissionContainer,
            {
              paddingTop: insets.top + Spacing.xl,
              paddingBottom: tabBarHeight + Spacing.xl,
            },
          ]}
        >
          <Feather name="smartphone" size={64} color={theme.textSecondary} />
          <ThemedText style={styles.permissionTitle}>Run in Expo Go</ThemedText>
          <ThemedText style={[styles.permissionText, { color: theme.textSecondary }]}>
            Camera works best in the Expo Go app. Scan the QR code to open on your device.
          </ThemedText>
          <Pressable
            style={({ pressed }) => [
              styles.uploadButton,
              { borderColor: theme.border },
              pressed && styles.buttonPressed,
            ]}
            onPress={pickImage}
          >
            <Feather name="upload" size={20} color={theme.tabIconSelected} />
            <ThemedText style={[styles.uploadButtonText, { color: theme.tabIconSelected }]}>
              Upload from Library
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  // Snapchat-like camera interface
  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash ? "on" : "off"}
        enableTorch={flash}
      />

      {/* Top Controls - Absolute positioning */}
      <View
        style={[
          styles.topControls,
          { paddingTop: insets.top + Spacing.md },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.topButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={toggleFlash}
        >
          <Feather
            name={flash ? "zap" : "zap-off"}
            size={28}
            color="#FFFFFF"
          />
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.topButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={toggleFacing}
        >
          <Feather name="rotate-cw" size={28} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Bottom Controls - Snapchat Style */}
      <View
        style={[
          styles.bottomControls,
          { paddingBottom: tabBarHeight + Spacing.lg },
        ]}
      >
        {/* Gallery Button */}
        <Pressable
          style={({ pressed }) => [
            styles.sideButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={pickImage}
        >
          <Feather name="image" size={32} color="#FFFFFF" />
        </Pressable>

        {/* Capture Button - Center */}
        <Pressable
          style={({ pressed }) => [
            styles.captureButton,
            pressed && styles.captureButtonPressed,
            isCapturing && styles.captureButtonDisabled,
          ]}
          onPress={takePhoto}
          disabled={isCapturing}
        >
          <View style={styles.captureButtonInner} />
        </Pressable>

        {/* Placeholder for symmetry */}
        <View style={styles.sideButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  camera: {
    flex: 1,
  },
  topControls: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    zIndex: 10,
  },
  topButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  bottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    zIndex: 10,
  },
  sideButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  captureButtonPressed: {
    transform: [{ scale: 0.9 }],
  },
  captureButtonDisabled: {
    opacity: 0.6,
  },
  captureButtonInner: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: "#FFFFFF",
  },
  buttonPressed: {
    opacity: 0.6,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "600",
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  permissionText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: Spacing.lg,
    lineHeight: 24,
  },
  permissionButton: {
    height: 52,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 200,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  uploadButton: {
    flexDirection: "row",
    height: 52,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    minWidth: 200,
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});

import React, { useState, useRef, useEffect } from "react";
import { View, StyleSheet, Pressable, Platform, Alert, Dimensions, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  Easing,
} from "react-native-reanimated";
import Svg, { Defs, Rect, Mask, Ellipse } from "react-native-svg";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { hapticFeedback } from "@/lib/haptics";
import { apiRequest, queryClient } from "@/lib/query-client";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const OVAL_WIDTH = SCREEN_WIDTH * 0.7;
const OVAL_HEIGHT = OVAL_WIDTH * 1.35;

interface SelectedImage {
  uri: string;
  base64: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [facing, setFacing] = useState<CameraType>("front");
  const [flash, setFlash] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [batchImages, setBatchImages] = useState<SelectedImage[]>([]);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const borderOpacity = useSharedValue(0.6);
  const batchPanelHeight = useSharedValue(0);

  useEffect(() => {
    borderOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 1200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  useEffect(() => {
    batchPanelHeight.value = withSpring(showBatchPanel ? 140 : 0, { damping: 15, stiffness: 150 });
  }, [showBatchPanel]);

  const borderAnimatedStyle = useAnimatedStyle(() => ({
    opacity: borderOpacity.value,
  }));

  const batchPanelStyle = useAnimatedStyle(() => ({
    height: batchPanelHeight.value,
    opacity: batchPanelHeight.value > 10 ? 1 : 0,
  }));

  const toggleFacing = () => {
    hapticFeedback.light();
    setFacing((current) => (current === "back" ? "front" : "back"));
  };

  const toggleFlash = () => {
    hapticFeedback.light();
    setFlash((current) => !current);
  };

  const takePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;

    hapticFeedback.medium();
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 1,
      });

      if (photo?.base64) {
        if (showBatchPanel) {
          setBatchImages((prev) => [...prev, { uri: photo.uri, base64: photo.base64! }]);
          hapticFeedback.success();
        } else {
          navigation.navigate("Processing", { imageBase64: photo.base64 });
        }
      }
    } catch (error) {
      console.error("Error Taking Photo:", error);
      hapticFeedback.error();
      Alert.alert("Error", "Failed to capture photo, please try again.");
    } finally {
      setIsCapturing(false);
    }
  };

  const pickImages = async () => {
    hapticFeedback.light();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 1,
        base64: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        if (result.assets.length === 1 && result.assets[0]?.base64) {
          navigation.navigate("Processing", { imageBase64: result.assets[0].base64 });
        } else {
          const images = result.assets
            .filter((asset) => asset.base64)
            .map((asset) => ({ uri: asset.uri, base64: asset.base64! }));
          setBatchImages(images);
          setShowBatchPanel(true);
          hapticFeedback.success();
        }
      }
    } catch (error) {
      console.error("Error Picking Images:", error);
      hapticFeedback.error();
      Alert.alert("Error", "Failed to pick images, please try again.");
    }
  };

  const pickSingleImage = async () => {
    hapticFeedback.light();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 1,
        base64: true,
      });

      if (!result.canceled && result.assets[0]?.base64) {
        navigation.navigate("Processing", { imageBase64: result.assets[0].base64 });
      }
    } catch (error) {
      console.error("Error Picking Image:", error);
      hapticFeedback.error();
      Alert.alert("Error", "Failed to pick image, please try again.");
    }
  };

  const importZipBatch = async () => {
    hapticFeedback.light();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/zip",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets[0]?.uri) return;

      const zipBase64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const response = await apiRequest("POST", "/api/photos/import-zip", { zipBase64 });
      const data = (await response.json()) as {
        importedCount: number;
        skippedCount: number;
        skipped?: Array<{ fileName: string; reason: string }>;
      };

      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      hapticFeedback.success();

      if (data.skippedCount > 0) {
        Alert.alert(
          "Import Completed With Skips",
          `Imported ${data.importedCount} Photos. Skipped ${data.skippedCount} Photos.`,
        );
      } else {
        Alert.alert("Import Completed", `Imported ${data.importedCount} Photos.`);
      }
    } catch (error) {
      console.error("Error Importing Zip Batch:", error);
      hapticFeedback.error();
      Alert.alert(
        "Import Failed",
        "Unable To Import Zip Batch. Check tags.json And File Names, Then Try Again.",
      );
    }
  };

  const processBatch = () => {
    if (batchImages.length === 0) return;
    hapticFeedback.medium();
    navigation.navigate("Processing", { imageBase64: batchImages[0].base64 });
    setBatchImages([]);
    setShowBatchPanel(false);
  };

  const removeFromBatch = (index: number) => {
    hapticFeedback.light();
    setBatchImages((prev) => prev.filter((_, i) => i !== index));
    if (batchImages.length <= 1) {
      setShowBatchPanel(false);
    }
  };

  const toggleBatchMode = () => {
    hapticFeedback.selection();
    if (showBatchPanel && batchImages.length === 0) {
      setShowBatchPanel(false);
    } else {
      setShowBatchPanel(!showBatchPanel);
    }
  };

  const ovalCenterY = insets.top + 80 + OVAL_HEIGHT / 2;

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
            Application needs camera access to capture and process photos.
          </ThemedText>
          <GlassButton
            title="Enable Camera"
            icon="camera"
            onPress={requestPermission}
            style={styles.glassButtonStyle}
          />
          <GlassButton
            title="Upload Photos"
            icon="upload"
            variant="secondary"
            onPress={pickSingleImage}
            style={styles.glassButtonStyle}
          />
          <GlassButton
            title="Import Zip Batch"
            icon="folder"
            variant="secondary"
            onPress={importZipBatch}
            style={styles.glassButtonStyle}
          />
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
          <GlassButton
            title="Upload Single Photo"
            icon="image"
            onPress={pickSingleImage}
            style={styles.glassButtonStyle}
          />
          <GlassButton
            title="Batch Upload"
            icon="layers"
            variant="secondary"
            onPress={pickImages}
            style={styles.glassButtonStyle}
          />
          <GlassButton
            title="Import Zip Batch"
            icon="folder"
            variant="secondary"
            onPress={importZipBatch}
            style={styles.glassButtonStyle}
          />
        </View>
      </ThemedView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash ? "on" : "off"}
        enableTorch={flash}
      />

      <View style={styles.overlayContainer} pointerEvents="none">
        <Svg width={SCREEN_WIDTH} height={SCREEN_HEIGHT} style={StyleSheet.absoluteFill}>
          <Defs>
            <Mask id="ovalMask">
              <Rect x="0" y="0" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fill="white" />
              <Ellipse
                cx={SCREEN_WIDTH / 2}
                cy={ovalCenterY}
                rx={OVAL_WIDTH / 2}
                ry={OVAL_HEIGHT / 2}
                fill="black"
              />
            </Mask>
          </Defs>
          <Rect
            x="0"
            y="0"
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            fill="rgba(0, 0, 0, 0.6)"
            mask="url(#ovalMask)"
          />
        </Svg>

        <Animated.View style={[StyleSheet.absoluteFill, borderAnimatedStyle]}>
          <Svg width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>
            <Ellipse
              cx={SCREEN_WIDTH / 2}
              cy={ovalCenterY}
              rx={OVAL_WIDTH / 2}
              ry={OVAL_HEIGHT / 2}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={3}
            />
          </Svg>
        </Animated.View>

        <View style={[styles.hintContainer, { top: ovalCenterY + OVAL_HEIGHT / 2 + 24 }]}>
          <ThemedText style={styles.hintText}>
            Position Face Within Oval
          </ThemedText>
        </View>
      </View>

      <View
        style={[
          styles.topControls,
          { paddingTop: insets.top + Spacing.md },
        ]}
      >
        <GlassIconButton
          icon={flash ? "zap" : "zap-off"}
          onPress={toggleFlash}
          isDark={isDark}
        />

        <GlassIconButton
          icon="layers"
          onPress={toggleBatchMode}
          isDark={isDark}
          active={showBatchPanel}
          activeColor={theme.tabIconSelected}
        />

        <GlassIconButton
          icon="rotate-cw"
          onPress={toggleFacing}
          isDark={isDark}
        />
      </View>

      <Animated.View style={[styles.batchPanel, batchPanelStyle]}>
        {Platform.OS === "ios" ? (
          <BlurView intensity={80} tint={isDark ? "dark" : "light"} style={styles.batchPanelContent}>
            <View style={styles.batchHeader}>
              <ThemedText style={styles.batchTitle}>
                {batchImages.length} photo{batchImages.length !== 1 ? "s" : ""} selected
              </ThemedText>
              {batchImages.length > 0 ? (
                <Pressable onPress={processBatch} style={styles.processBatchButton}>
                  <ThemedText style={[styles.processBatchText, { color: theme.tabIconSelected }]}>
                    Process All
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            <FlatList
              data={batchImages}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.batchList}
              keyExtractor={(_, index) => index.toString()}
              renderItem={({ item, index }) => (
                <View style={styles.batchImageContainer}>
                  <Image source={{ uri: item.uri }} style={styles.batchImage} contentFit="cover" />
                  <Pressable
                    style={[styles.removeBatchButton, { backgroundColor: theme.error }]}
                    onPress={() => removeFromBatch(index)}
                  >
                    <Feather name="x" size={12} color="#FFFFFF" />
                  </Pressable>
                </View>
              )}
            />
          </BlurView>
        ) : (
          <View style={[styles.batchPanelContent, { backgroundColor: isDark ? "rgba(28, 28, 30, 0.95)" : "rgba(255, 255, 255, 0.95)" }]}>
            <View style={styles.batchHeader}>
              <ThemedText style={styles.batchTitle}>
                {batchImages.length} photo{batchImages.length !== 1 ? "s" : ""} selected
              </ThemedText>
              {batchImages.length > 0 ? (
                <Pressable onPress={processBatch} style={styles.processBatchButton}>
                  <ThemedText style={[styles.processBatchText, { color: theme.tabIconSelected }]}>
                    Process All
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            <FlatList
              data={batchImages}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.batchList}
              keyExtractor={(_, index) => index.toString()}
              renderItem={({ item, index }) => (
                <View style={styles.batchImageContainer}>
                  <Image source={{ uri: item.uri }} style={styles.batchImage} contentFit="cover" />
                  <Pressable
                    style={[styles.removeBatchButton, { backgroundColor: theme.error }]}
                    onPress={() => removeFromBatch(index)}
                  >
                    <Feather name="x" size={12} color="#FFFFFF" />
                  </Pressable>
                </View>
              )}
            />
          </View>
        )}
      </Animated.View>

      <View
        style={[
          styles.bottomControls,
          { paddingBottom: tabBarHeight + Spacing.lg },
        ]}
      >
        <GlassIconButton
          icon="image"
          size={52}
          onPress={pickImages}
          isDark={isDark}
        />

        <CaptureButton
          onPress={takePhoto}
          disabled={isCapturing}
          batchMode={showBatchPanel}
          theme={theme}
        />

        <GlassIconButton
          icon="folder"
          size={52}
          onPress={importZipBatch}
          isDark={isDark}
        />
      </View>
    </View>
  );
}

interface GlassIconButtonProps {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  isDark: boolean;
  size?: number;
  active?: boolean;
  activeColor?: string;
}

function GlassIconButton({ icon, onPress, isDark, size = 50, active, activeColor }: GlassIconButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={animatedStyle}
    >
      <View style={[styles.glassIconButton, { width: size, height: size, borderRadius: size / 2 }]}>
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={60}
            tint={isDark ? "dark" : "light"}
            style={[styles.glassIconBlur, { borderRadius: size / 2, width: size, height: size }]}
          >
            <Feather name={icon} size={size * 0.46} color={active && activeColor ? activeColor : "#FFFFFF"} />
          </BlurView>
        ) : (
          <View style={[styles.glassIconContent, { backgroundColor: "rgba(0, 0, 0, 0.4)", borderRadius: size / 2 }]}>
            <Feather name={icon} size={size * 0.48} color={active && activeColor ? activeColor : "#FFFFFF"} />
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

interface CaptureButtonProps {
  onPress: () => void;
  disabled: boolean;
  batchMode: boolean;
  theme: any;
}

function CaptureButton({ onPress, disabled, batchMode, theme }: CaptureButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled) {
      scale.value = withSpring(0.9);
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[styles.captureButton, animatedStyle, disabled && styles.captureButtonDisabled]}
    >
      <View style={[styles.captureButtonInner, batchMode && { backgroundColor: theme.tabIconSelected }]}>
        {batchMode ? <Feather name="plus" size={28} color="#FFFFFF" /> : null}
      </View>
    </AnimatedPressable>
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
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  hintContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hintText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
  batchPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 160,
    zIndex: 15,
    overflow: "hidden",
  },
  batchPanelContent: {
    flex: 1,
    paddingVertical: Spacing.sm,
  },
  batchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  batchTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  processBatchButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  processBatchText: {
    fontSize: 14,
    fontWeight: "700",
  },
  batchList: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  batchImageContainer: {
    marginRight: Spacing.sm,
    position: "relative",
  },
  batchImage: {
    width: 70,
    height: 90,
    borderRadius: BorderRadius.sm,
  },
  removeBatchButton: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  glassIconButton: {
    overflow: "hidden",
  },
  glassIconContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  glassIconBlur: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  captureButtonDisabled: {
    opacity: 0.6,
  },
  captureButtonInner: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
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
  glassButtonStyle: {
    marginTop: Spacing.sm,
    minWidth: 220,
  },
});

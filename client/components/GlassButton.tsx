import React from "react";
import { StyleSheet, View, ViewStyle, Platform, Pressable, ActivityIndicator } from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Typography } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";

interface GlassButtonProps {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: "primary" | "secondary" | "destructive";
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 200,
  overshootClamping: true,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function GlassButton({
  title,
  onPress,
  icon,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
  style,
}: GlassButtonProps) {
  const { theme, isDark } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled && !loading) {
      scale.value = withSpring(0.95, springConfig);
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, springConfig);
  };

  const handlePress = () => {
    if (!disabled && !loading) {
      hapticFeedback.light();
      onPress();
    }
  };

  const getHeight = () => {
    switch (size) {
      case "small":
        return 36;
      case "large":
        return 56;
      default:
        return 48;
    }
  };

  const getTextColor = () => {
    if (disabled) return theme.textTertiary;
    switch (variant) {
      case "destructive":
        return theme.error;
      case "secondary":
        return theme.tabIconSelected;
      default:
        return "#FFFFFF";
    }
  };

  const getBackgroundColor = () => {
    if (disabled) return isDark ? "rgba(60, 60, 67, 0.3)" : "rgba(120, 120, 128, 0.2)";
    switch (variant) {
      case "primary":
        return theme.tabIconSelected;
      case "destructive":
        return "transparent";
      default:
        return "transparent";
    }
  };

  const getBorderColor = () => {
    if (disabled) return "transparent";
    switch (variant) {
      case "primary":
        return "transparent";
      case "destructive":
        return theme.error;
      default:
        return isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.1)";
    }
  };

  const iconSize = size === "small" ? 16 : size === "large" ? 22 : 18;
  const fontSize = size === "small" ? 14 : size === "large" ? 18 : 16;

  const content = (
    <View style={styles.content}>
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={iconSize} color={getTextColor()} /> : null}
          <ThemedText style={[styles.text, { color: getTextColor(), fontSize }]}>
            {title}
          </ThemedText>
        </>
      )}
    </View>
  );

  const containerStyle: ViewStyle = {
    height: getHeight(),
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: variant !== "primary" ? 1.5 : 0,
    borderColor: getBorderColor(),
    opacity: disabled ? 0.6 : 1,
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[animatedStyle, style]}
    >
      <View style={containerStyle}>
        {variant === "primary" ? (
          <View style={[styles.solidBackground, { backgroundColor: getBackgroundColor() }]}>
            {content}
          </View>
        ) : Platform.OS === "ios" ? (
          <BlurView
            intensity={40}
            tint={isDark ? "dark" : "light"}
            style={styles.blurContent}
          >
            {content}
          </BlurView>
        ) : (
          <View
            style={[
              styles.fallbackContent,
              {
                backgroundColor: isDark
                  ? "rgba(28, 28, 30, 0.7)"
                  : "rgba(255, 255, 255, 0.7)",
              },
            ]}
          >
            {content}
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  blurContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fallbackContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  solidBackground: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  text: {
    fontWeight: "600",
  },
});

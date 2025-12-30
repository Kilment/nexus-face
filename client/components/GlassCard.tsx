import React from "react";
import { StyleSheet, View, ViewStyle, Platform, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";

interface GlassCardProps {
  children?: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  intensity?: number;
  padding?: number;
  borderRadius?: number;
  haptic?: boolean;
}

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function GlassCard({
  children,
  style,
  onPress,
  intensity = 60,
  padding = Spacing.md,
  borderRadius = BorderRadius.lg,
  haptic = true,
}: GlassCardProps) {
  const { isDark } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, springConfig);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, springConfig);
  };

  const handlePress = () => {
    if (haptic) {
      hapticFeedback.light();
    }
    onPress?.();
  };

  const containerStyle: ViewStyle = {
    borderRadius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)",
  };

  const innerContent = (
    <View style={containerStyle}>
      {Platform.OS === "ios" ? (
        <BlurView
          intensity={intensity}
          tint={isDark ? "dark" : "light"}
          style={[styles.blurContent, { padding }]}
        >
          {children}
        </BlurView>
      ) : (
        <View
          style={[
            styles.fallbackContent,
            {
              padding,
              backgroundColor: isDark
                ? "rgba(28, 28, 30, 0.85)"
                : "rgba(255, 255, 255, 0.85)",
            },
          ]}
        >
          {children}
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[animatedStyle, style]}
      >
        {innerContent}
      </AnimatedPressable>
    );
  }

  return <View style={style}>{innerContent}</View>;
}

const styles = StyleSheet.create({
  blurContent: {
    width: "100%",
  },
  fallbackContent: {
    width: "100%",
  },
});

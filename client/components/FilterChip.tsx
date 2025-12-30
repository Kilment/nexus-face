import React from "react";
import { StyleSheet, Pressable, Platform, View } from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function FilterChip({ label, selected, onPress, icon }: FilterChipProps) {
  const { theme, isDark } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.95);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const handlePress = () => {
    hapticFeedback.selection();
    onPress();
  };

  const content = (
    <View style={styles.content}>
      {icon ? (
        <Feather
          name={icon}
          size={14}
          color={selected ? "#FFFFFF" : theme.textSecondary}
        />
      ) : null}
      <ThemedText
        style={[
          styles.text,
          { color: selected ? "#FFFFFF" : theme.text },
        ]}
      >
        {label}
      </ThemedText>
    </View>
  );

  if (selected) {
    return (
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={animatedStyle}
      >
        <View
          style={[
            styles.selectedContainer,
            { backgroundColor: theme.tabIconSelected },
          ]}
        >
          {content}
        </View>
      </AnimatedPressable>
    );
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={animatedStyle}
    >
      <View style={styles.chipContainer}>
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={40}
            tint={isDark ? "dark" : "light"}
            style={styles.blurChip}
          >
            {content}
          </BlurView>
        ) : (
          <View
            style={[
              styles.fallbackChip,
              {
                backgroundColor: isDark
                  ? "rgba(60, 60, 67, 0.5)"
                  : "rgba(120, 120, 128, 0.2)",
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
  chipContainer: {
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  selectedContainer: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  blurChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  fallbackChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  text: {
    fontSize: 14,
    fontWeight: "500",
  },
});

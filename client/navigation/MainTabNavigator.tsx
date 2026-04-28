import React from "react";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import GalleryStackNavigator from "@/navigation/GalleryStackNavigator";
import CameraStackNavigator from "@/navigation/CameraStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius } from "@/constants/theme";

/** Must match `tabPill` width/height so TabBarIcon’s wrapper isn’t 31×28 over a 84×40 pill (that skews layout). */
const TAB_PILL_WIDTH = 84;
const TAB_PILL_HEIGHT = 40;
/** Inner horizontal padding inside the floating pill (added to safe-area horizontal inset). */
const TAB_BAR_INNER_PADDING_H = 12;

export type MainTabParamList = {
  GalleryTab: undefined;
  CameraTab: undefined;
  ProfileTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabPill({
  icon,
  color,
  focused,
  isDark,
}: {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  focused: boolean;
  isDark: boolean;
}) {
  return (
    <View
      style={[styles.tabPill, focused && (isDark ? styles.tabPillFocusedDark : styles.tabPillFocusedLight)]}
    >
      <Feather name={icon} size={20} color={color} />
    </View>
  );
}

/** Default tab uses `justifyContent: "flex-start"` for column layout; center so pills sit in the pill bar. */
function CenteredTabBarButton(props: BottomTabBarButtonProps) {
  const { style, ...rest } = props;
  return (
    <PlatformPressable
      {...rest}
      style={[style, { justifyContent: "center", alignItems: "center" }]}
    />
  );
}

export default function MainTabNavigator() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="CameraTab"
      screenOptions={{
        tabBarActiveTintColor: isDark ? "#35A0FF" : "#0A84FF",
        tabBarInactiveTintColor: isDark ? "#D5DAE1" : "#A8AFB8",
        tabBarShowLabel: false,
        tabBarButton: (buttonProps) => <CenteredTabBarButton {...buttonProps} />,
        tabBarIconStyle: styles.tabBarIconWrap,
        tabBarItemStyle: styles.tabBarItem,
        tabBarStyle: [
          styles.tabBar,
          {
            paddingBottom: 6 + insets.bottom,
            paddingHorizontal: TAB_BAR_INNER_PADDING_H + Math.max(insets.left, insets.right),
            shadowOpacity: isDark ? 0.42 : 0.16,
          },
        ],
        tabBarBackground: () => (
          <View style={styles.tabBarBackground}>
            <BlurView intensity={95} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
            <View
              pointerEvents="none"
              style={[styles.glassOverlay, isDark ? styles.glassOverlayDark : styles.glassOverlayLight]}
            />
            <View
              pointerEvents="none"
              style={[styles.glassTopEdge, isDark ? styles.glassTopEdgeDark : styles.glassTopEdgeLight]}
            />
          </View>
        ),
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="GalleryTab"
        component={GalleryStackNavigator}
        options={{
          title: "Gallery",
          tabBarIcon: ({ color, focused }) => (
            <TabPill icon="image" color={color} focused={focused} isDark={isDark} />
          ),
        }}
      />
      <Tab.Screen
        name="CameraTab"
        component={CameraStackNavigator}
        options={{
          title: "Capture",
          tabBarIcon: ({ color, focused }) => (
            <TabPill icon="aperture" color={color} focused={focused} isDark={isDark} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => {
            const state = navigation.getState();
            const isFocused = state.routes[state.index]?.key === route.key;
            if (!isFocused) return;
            e.preventDefault();
            navigation.navigate("ProfileTab", { screen: "Profile" } as never);
          },
        })}
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabPill icon="user" color={color} focused={focused} isDark={isDark} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    backgroundColor: "transparent",
    borderTopWidth: 0,
    elevation: 0,
    height: Platform.select({ ios: 76, android: 74, web: 74 }),
    margin: Platform.select({ ios: 14, android: 16, web: 16 }),
    borderRadius: 34,
    bottom: 0,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  tabBarIconWrap: {
    width: TAB_PILL_WIDTH,
    height: TAB_PILL_HEIGHT,
  },
  tabBarItem: {
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
    marginHorizontal: 0,
    marginVertical: 0,
    paddingVertical: 0,
  },
  tabBarBackground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 34,
    overflow: "hidden",
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  glassOverlayLight: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.6)",
  },
  glassOverlayDark: {
    backgroundColor: "rgba(32, 32, 34, 0.34)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  glassTopEdge: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
  },
  glassTopEdgeLight: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
  },
  glassTopEdgeDark: {
    backgroundColor: "rgba(255, 255, 255, 0.24)",
  },
  tabPill: {
    width: TAB_PILL_WIDTH,
    height: TAB_PILL_HEIGHT,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  tabPillFocusedLight: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  tabPillFocusedDark: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
});

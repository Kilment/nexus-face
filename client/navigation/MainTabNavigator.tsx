import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import GalleryStackNavigator from "@/navigation/GalleryStackNavigator";
import CameraStackNavigator from "@/navigation/CameraStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius } from "@/constants/theme";

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
    <View style={[styles.tabPill, focused && (isDark ? styles.tabPillFocusedDark : styles.tabPillFocusedLight)]}>
      <Feather name={icon} size={21} color={color} />
    </View>
  );
}

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="CameraTab"
      screenOptions={{
        tabBarActiveTintColor: isDark ? "#35A0FF" : "#0A84FF",
        tabBarInactiveTintColor: isDark ? "#D5DAE1" : "#A8AFB8",
        tabBarShowLabel: false,
        tabBarItemStyle: styles.tabBarItem,
        tabBarStyle: {
          ...styles.tabBar,
          shadowOpacity: isDark ? 0.42 : 0.16,
        },
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
    height: Platform.select({ ios: 74, android: 72, web: 72 }),
    paddingBottom: Platform.select({ ios: 4, android: 6, web: 6 }),
    margin: 16,
    borderRadius: 34,
    bottom: 0,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  tabBarItem: {
    justifyContent: "center",
    alignItems: "center",
    paddingTop: Platform.select({ ios: 4, android: 8, web: 8 }),
    marginHorizontal: 8,
    marginVertical: Platform.select({ ios: 2, android: 6, web: 6 }),
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
    width: 92,
    height: 44,
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

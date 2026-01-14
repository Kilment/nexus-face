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

function TabBarIcon({ name, color, focused }: { name: keyof typeof Feather.glyphMap; color: string; focused: boolean }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerFocused]}>
      <Feather name={name} size={22} color={color} />
    </View>
  );
}

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="CameraTab"
      screenOptions={{
        tabBarActiveTintColor: theme.tabIconSelected,
        tabBarInactiveTintColor: theme.tabIconDefault,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
        },
        tabBarItemStyle: {
          justifyContent: "center",
          alignItems: "center",
          height: Platform.select({ ios: 48, android: 72, web: 72 }),
          paddingTop: 20,
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Platform.select({
            ios: "transparent",
            android: "transparent",
            web: "transparent",
          }),
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.select({ ios: 88, android: 72, web: 72 }),
          paddingBottom: 0,
          margin: 16,
          borderRadius: 32,
          bottom: 0,
          overflow: "hidden",
        },
        tabBarBackground: () => (
          <BlurView
            intensity={80}
            tint={isDark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
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
            <TabBarIcon name="image" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="CameraTab"
        component={CameraStackNavigator}
        options={{
          title: "Capture",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="aperture" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="user" color={color} focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 44,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.sm,
  },
  iconContainerFocused: {
    backgroundColor: "rgba(0, 122, 255, 0.12)",
  },
});

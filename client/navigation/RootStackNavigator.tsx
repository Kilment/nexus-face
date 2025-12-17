import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import ProcessingScreen from "@/screens/ProcessingScreen";
import TaggingScreen from "@/screens/TaggingScreen";
import LinkPhotoScreen from "@/screens/LinkPhotoScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useAuth } from "@/lib/auth-context";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";

export type RootStackParamList = {
  Main: undefined;
  Login: undefined;
  Processing: { imageBase64: string };
  Tagging: { processedImageBase64: string };
  LinkPhoto: { photoId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions({ transparent: false });
  const { isAuthenticated, isLoading } = useAuth();
  const { theme } = useTheme();

  if (isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator size="large" color={theme.tabIconSelected} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {!isAuthenticated ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Processing"
            component={ProcessingScreen}
            options={{
              presentation: "modal",
              headerTitle: "Processing",
            }}
          />
          <Stack.Screen
            name="Tagging"
            component={TaggingScreen}
            options={{
              presentation: "modal",
              headerTitle: "Tag Photo",
            }}
          />
          <Stack.Screen
            name="LinkPhoto"
            component={LinkPhotoScreen}
            options={{
              presentation: "modal",
              headerTitle: "Link Photos",
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});

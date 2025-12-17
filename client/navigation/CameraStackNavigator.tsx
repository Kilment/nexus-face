import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import CameraScreen from "@/screens/CameraScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type CameraStackParamList = {
  Camera: undefined;
};

const Stack = createNativeStackNavigator<CameraStackParamList>();

export default function CameraStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Camera"
        component={CameraScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

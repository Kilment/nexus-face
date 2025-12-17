import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import GalleryScreen from "@/screens/GalleryScreen";
import PhotoDetailScreen from "@/screens/PhotoDetailScreen";
import LinkedPairScreen from "@/screens/LinkedPairScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type GalleryStackParamList = {
  Gallery: undefined;
  PhotoDetail: { photoId: string };
  LinkedPair: { photoId: string; linkedPhotoId: string };
};

const Stack = createNativeStackNavigator<GalleryStackParamList>();

export default function GalleryStackNavigator() {
  const screenOptions = useScreenOptions({ transparent: false });

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{ headerTitle: "Gallery" }}
      />
      <Stack.Screen
        name="PhotoDetail"
        component={PhotoDetailScreen}
        options={{ headerTitle: "Photo Details" }}
      />
      <Stack.Screen
        name="LinkedPair"
        component={LinkedPairScreen}
        options={{ headerTitle: "Before & After" }}
      />
    </Stack.Navigator>
  );
}

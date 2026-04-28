import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProfileScreen from "@/screens/ProfileScreen";
import StudiesListScreen from "@/screens/StudiesListScreen";
import StudyComposeScreen from "@/screens/StudyComposeScreen";
import StudyDetailScreen from "@/screens/StudyDetailScreen";
import StudyResultsScreen from "@/screens/StudyResultsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type ProfileStackParamList = {
  Profile: undefined;
  StudiesList: undefined;
  StudyCompose: { studyId?: string } | undefined;
  StudyDetail: { studyId: string; entryPoint?: "pairs" | "cohorts" };
  StudyResults: { studyId: string };
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStackNavigator() {
  const screenOptions = useScreenOptions({ transparent: true });

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          headerTitle: "Profile",
          // Root of this stack — hide back; nested screens use useScreenOptions headerLeft via default.
          headerLeft: () => null,
        }}
      />
      <Stack.Screen
        name="StudiesList"
        component={StudiesListScreen}
        options={{ headerTitle: "Cohort Studies" }}
      />
      <Stack.Screen
        name="StudyCompose"
        component={StudyComposeScreen}
        options={{ headerTitle: "New Cohort" }}
      />
      <Stack.Screen
        name="StudyDetail"
        component={StudyDetailScreen}
        options={{ headerTitle: "Study" }}
      />
      <Stack.Screen
        name="StudyResults"
        component={StudyResultsScreen}
        options={{ headerTitle: "Results" }}
      />
    </Stack.Navigator>
  );
}

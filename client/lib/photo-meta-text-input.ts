import { Keyboard, Platform, TextInputProps } from "react-native";

/**
 * Toolbar id for ios `InputAccessoryView` — used with numeric keypads that have no "return" key.
 * @see ../components/IosNumericInputAccessory.tsx
 */
export const PHOTO_META_NUMERIC_ACCESSORY_NATIVE_ID = "photo-meta-numeric-done";

/** Same native ID for `inputAccessoryViewID` on iOS numeric fields. */
export function photoMetaNumericAccessoryId(): Pick<TextInputProps, "inputAccessoryViewID"> | Record<string, never> {
  if (Platform.OS !== "ios") return {};
  return { inputAccessoryViewID: PHOTO_META_NUMERIC_ACCESSORY_NATIVE_ID };
}

const privacyAndroid: Partial<TextInputProps> = {
  autoCorrect: false,
  spellCheck: false,
  autoComplete: "off",
  importantForAutofill: "no",
};

const privacyIos: Partial<TextInputProps> = {
  autoCorrect: false,
  spellCheck: false,
  autoComplete: "off",
  textContentType: "none",
};

const privacy =
  Platform.OS === "android" ? privacyAndroid : privacyIos;

/**
 * Initials, location codes, intervention labels — no autofill / autocorrect / predictive text.
 * Use together with `{...photoMetaKeyboardDismissOnDone()}`
 */
export const PHOTO_TAG_FIELD_PRIVACY: Partial<TextInputProps> = privacy;

/** Dismiss keyboard when user presses Done/Enter (single-line fields with visible return key only). */
export function photoMetaKeyboardDismissOnDone(): Pick<
  TextInputProps,
  "returnKeyType" | "blurOnSubmit" | "onSubmitEditing"
> {
  return {
    returnKeyType: "done",
    blurOnSubmit: true,
    onSubmitEditing: () => {
      Keyboard.dismiss();
    },
  };
}

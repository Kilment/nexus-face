import { NOT_AVAILABLE } from "@shared/cohort-metrics";

/**
 * Single place that decides how an undetermined value is shown.
 *
 * These fields are frequently null: gender is only recorded above a confidence
 * threshold, and age range only when the detector returns a bounded one. A
 * null must read as N/A, never as a blank that looks like a value was never
 * sought, and never as a substituted default.
 */

export { NOT_AVAILABLE };

/** Compact badge form for grid overlays, e.g. "F 32-40" / "N/A 32-40". */
export function formatDemographicBadge(
  gender: string | null | undefined,
  ageRange: string | null | undefined,
): string {
  const g = gender ? gender.charAt(0).toUpperCase() : NOT_AVAILABLE;
  const a = ageRange ?? NOT_AVAILABLE;
  return `${g} ${a}`;
}

/** Full form for detail rows, e.g. "Female, 32-40" / "N/A, N/A". */
export function formatDemographicsFull(
  gender: string | null | undefined,
  ageRange: string | null | undefined,
): string {
  return `${gender ?? NOT_AVAILABLE}, ${ageRange ?? NOT_AVAILABLE}`;
}

/** Any numeric metric that may be undetermined. */
export function formatValue(
  value: number | null | undefined,
  digits = 1,
  suffix = "",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NOT_AVAILABLE;
  }
  return `${value.toFixed(digits)}${suffix}`;
}

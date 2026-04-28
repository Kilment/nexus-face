import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
});

/**
 * API origin for native fetch. Uses EXPO_PUBLIC_DOMAIN when set (e.g. Replit
 * `host:5000`), otherwise local development on port 5000.
 */
export function getApiUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    const protocol = domain.includes("localhost") ? "http" : "https";
    return `${protocol}://${domain}`;
  }
  return `http://localhost:${process.env.PORT ?? "5000"}`;
}

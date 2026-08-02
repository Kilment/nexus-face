import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { getApiUrl } from "@/lib/query-client";
import { saveAuthToken, getAuthToken, clearAuthToken } from "@/lib/auth-token";

export interface User {
  id: string;
  email?: string | null;
  username: string;
  profileImageUrl: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True only where Sign in with Apple is actually available. */
  isAppleAuthAvailable: boolean;
  signInWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Authenticated fetch. Identity always rides on the server-issued token. */
export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  return fetch(new URL(path, getApiUrl()).toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAppleAuthAvailable, setIsAppleAuthAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync()
      .then(setIsAppleAuthAvailable)
      .catch(() => setIsAppleAuthAvailable(false));
  }, []);

  /**
   * Validate the stored token against the server.
   *
   * The user object is never treated as a credential — identity comes from the
   * server resolving the bearer token. A 401 means revoked or expired, so the
   * token is discarded rather than trusted offline.
   */
  const checkAuth = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        setUser(null);
        return;
      }
      const response = await authedFetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else if (response.status === 401) {
        await clearAuthToken();
        setUser(null);
      }
      // Other statuses (server down, offline) leave state alone so a transient
      // outage does not sign the user out.
    } catch {
      // Network failure — keep whatever state we already had.
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const signInWithApple = async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      throw new Error("Apple did not return an identity token.");
    }

    // Verified server-side against Apple's public keys; nothing the client
    // asserts about identity is trusted on its own.
    const response = await fetch(new URL("/api/auth/apple", getApiUrl()).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityToken: credential.identityToken,
        fullName: credential.fullName
          ? {
              givenName: credential.fullName.givenName,
              familyName: credential.fullName.familyName,
            }
          : null,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Sign-in failed.");
    }

    const data = await response.json();
    await saveAuthToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await authedFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the server call fails, drop the local credential.
    }
    await clearAuthToken();
    setUser(null);
  };

  const deleteAccount = async () => {
    const response = await authedFetch("/api/auth/account", { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Account deletion failed.");
    }
    await clearAuthToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAppleAuthAvailable,
        signInWithApple,
        logout,
        deleteAccount,
        checkAuth,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

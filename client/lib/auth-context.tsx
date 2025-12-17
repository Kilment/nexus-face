import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { getApiUrl, apiRequest } from "@/lib/query-client";

interface User {
  id: string;
  username: string;
  profileImageUrl: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await fetch(new URL("/api/auth/me", getApiUrl()).toString(), {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async () => {
    try {
      const baseUrl = getApiUrl();
      const authUrl = `https://replit.com/auth_with_repl_site?domain=${encodeURIComponent(baseUrl.replace("https://", "").replace("http://", ""))}`;
      
      if (Platform.OS === "web") {
        window.location.href = authUrl;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(
          authUrl,
          "facesnap://auth"
        );
        
        if (result.type === "success" && result.url) {
          const url = new URL(result.url);
          const token = url.searchParams.get("token");
          if (token) {
            const response = await apiRequest("POST", "/api/auth/replit", { token });
            const data = await response.json();
            setUser(data.user);
          }
        }
      }
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        checkAuth,
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

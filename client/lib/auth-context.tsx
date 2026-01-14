import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";

interface User {
  id: string;
  email?: string;
  username: string;
  profileImageUrl: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, username?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AUTH_STORAGE_KEY = "@facesnap_auth_user";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const storedUser = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        try {
          const response = await fetch(new URL("/api/auth/me", getApiUrl()).toString(), {
            headers: { "X-User-Id": parsedUser.id },
          });
          if (response.ok) {
            const data = await response.json();
            await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
            setUser(data.user);
          } else if (response.status === 401) {
            await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
            setUser(null);
          } else {
            setUser(parsedUser);
          }
        } catch {
          setUser(parsedUser);
        }
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

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch(new URL("/api/auth/login", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Login failed");
      }
      
      const data = await response.json();
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
      setUser(data.user);
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  };

  const signup = async (email: string, password: string, username?: string) => {
    try {
      const response = await fetch(new URL("/api/auth/signup", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, username }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Signup failed");
      }
      
      const data = await response.json();
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
      setUser(data.user);
    } catch (error) {
      console.error("Signup error:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      const response = await fetch(new URL("/api/auth/logout", getApiUrl()).toString(), {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Logout failed on server");
      }
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
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

export async function getStoredUserId(): Promise<string | null> {
  try {
    const storedUser = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      return parsedUser.id;
    }
    return null;
  } catch {
    return null;
  }
}

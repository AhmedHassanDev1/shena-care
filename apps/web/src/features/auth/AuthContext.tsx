'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { User, auth as authApi } from '@/lib/auth';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  requireAuth: (options?: { returnTo?: string; intent?: string }) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const refreshUser = useCallback(async () => {
    try {
      if (authApi.isAuthenticated()) {
        const userData = await authApi.getMe();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Failed to fetch user', error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const signOut = async () => {
    try {
      await authApi.logout();
      setUser(null);
      router.refresh();
    } catch (error) {
      console.error('Failed to logout', error);
    }
  };

  const requireAuth = (options?: { returnTo?: string; intent?: string }) => {
    if (user) return; // Already authenticated
    const currentParams = searchParams.toString();
    const returnTo = options?.returnTo || (pathname + (currentParams ? `?${currentParams}` : ''));
    
    const params = new URLSearchParams();
    if (returnTo) params.set('returnTo', returnTo);
    if (options?.intent) params.set('intent', options.intent);
    
    router.push(`/auth?${params.toString()}`);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, refreshUser, signOut, requireAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { User, auth as authApi } from '@/lib/auth';
import { AuthModal, type AuthModalOptions } from './components/AuthModal';

export type { AuthModalOptions };

export type PendingAuthAction = () => unknown | Promise<unknown>;

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshUser: () => Promise<User | null>;
  signOut: () => Promise<void>;
  requireAuth: (options?: { returnTo?: string; intent?: string }) => void;
  openAuthModal: (options?: AuthModalOptions) => void;
  closeAuthModal: () => void;
  withAuth: <T>(
    action: () => T | Promise<T>,
    options?: AuthModalOptions
  ) => Promise<T | void>;
  isAuthModalOpen: boolean;
  authModalOptions: AuthModalOptions | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalOptions, setAuthModalOptions] = useState<AuthModalOptions | null>(null);

  const pendingActionRef = useRef<PendingAuthAction | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const refreshUser = useCallback(async (): Promise<User | null> => {
    try {
      if (authApi.isAuthenticated()) {
        const userData = await authApi.getMe();
        setUser(userData);
        return userData;
      } else {
        setUser(null);
        return null;
      }
    } catch (error) {
      console.error('Failed to fetch user', error);
      setUser(null);
      return null;
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
    } catch (error) {
      console.error('Failed to logout', error);
    } finally {
      setUser(null);
      queryClient.removeQueries({ queryKey: ['customer'] });
      queryClient.removeQueries({ queryKey: ['my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      router.refresh();
    }
  };

  const requireAuth = (options?: { returnTo?: string; intent?: string }) => {
    if (user) return; // Already authenticated
    const currentParams = searchParams?.toString() ?? '';
    const returnTo =
      options?.returnTo ||
      (pathname + (currentParams ? `?${currentParams}` : ''));

    const params = new URLSearchParams();
    if (returnTo) params.set('returnTo', returnTo);
    if (options?.intent) params.set('intent', options.intent);

    router.push(`/auth?${params.toString()}`);
  };

  const openAuthModal = useCallback((options?: AuthModalOptions) => {
    setAuthModalOptions(options ?? null);
    setIsAuthModalOpen(true);
  }, []);

  const handleAuthDismiss = useCallback(() => {
    setIsAuthModalOpen(false);
    if (authModalOptions?.onDismiss) {
      try {
        authModalOptions.onDismiss();
      } catch (e) {
        console.error('Error in onDismiss callback', e);
      }
    }
    pendingActionRef.current = null;
    setAuthModalOptions(null);
  }, [authModalOptions]);

  const closeAuthModal = useCallback(() => {
    handleAuthDismiss();
  }, [handleAuthDismiss]);

  const handleAuthSuccess = useCallback(
    async (authenticatedUser: User) => {
      setUser(authenticatedUser);
      await refreshUser();

      if (authModalOptions?.onAuthenticated) {
        try {
          await authModalOptions.onAuthenticated(authenticatedUser);
        } catch (e) {
          console.error('Error in onAuthenticated callback', e);
        }
      }

      if (pendingActionRef.current) {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        try {
          await action();
        } catch (e) {
          console.error('Error executing queued auth action', e);
        }
      }

      setIsAuthModalOpen(false);
      setAuthModalOptions(null);
    },
    [refreshUser, authModalOptions]
  );

  const withAuth = useCallback(
    async <T,>(
      action: () => T | Promise<T>,
      options?: AuthModalOptions
    ): Promise<T | void> => {
      if (authApi.isAuthenticated() && user) {
        return await action();
      }

      return new Promise<T | void>((resolve, reject) => {
        pendingActionRef.current = async () => {
          try {
            const result = await action();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        };

        setAuthModalOptions({
          ...options,
          onDismiss: () => {
            options?.onDismiss?.();
            resolve(undefined);
          },
        });
        setIsAuthModalOpen(true);
      });
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        refreshUser,
        signOut,
        requireAuth,
        openAuthModal,
        closeAuthModal,
        withAuth,
        isAuthModalOpen,
        authModalOptions,
      }}
    >
      {children}
      <AuthModal
        isOpen={isAuthModalOpen}
        options={authModalOptions}
        onSuccess={handleAuthSuccess}
        onClose={handleAuthDismiss}
      />
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

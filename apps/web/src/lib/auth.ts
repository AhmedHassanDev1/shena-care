import { apiClient } from './api-client';
import { SESSION_TOKEN_KEY } from './session-token';
import type { OtpChallengeResponse } from '@/features/auth/lib/otp-challenge';

export interface User {
  id: string;
  /** Null until the customer gives a name (phone sign-up). */
  name: string | null;
  /** Null when unset (synthetic phone sign-up placeholder is hidden). */
  email: string | null;
  /** Verified sign-in number (E.164), offered as the order recipient's. */
  phoneNumber: string | null;
  createdAt?: string;
}

export interface UpdateProfileInput {
  name?: string;
  email?: string | null;
}

/** Hides synthetic phone-OTP placeholder emails from customer-facing UI. */
export function displayEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!trimmed || /@placeholder\.com$/i.test(trimmed)) return null;
  return trimmed;
}

export interface AuthResponse {
  user?: User;
  customer?: User;
  sessionToken?: string;
  token?: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
}

export interface LoginData {
  email: string;
  password: string;
}

/** POST /accounts/otp/verify. `returnTo` echoes a safe local path sent as `pendingIntent` with the code request. */
export interface VerifyOtpResponse {
  token: string;
  expiresAt: string;
  returnTo?: string;
}

const TOKEN_KEY = SESSION_TOKEN_KEY;

export const auth = {
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/accounts/register', data);
    if (response.sessionToken) {
      localStorage.setItem(TOKEN_KEY, response.sessionToken);
    }
    return response;
  },

  async login(data: LoginData): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/accounts/login', data);
    const sessionToken = response.sessionToken ?? response.token;
    if (sessionToken) {
      localStorage.setItem(TOKEN_KEY, sessionToken);
    }
    return response;
  },

  /** POST /accounts/otp/send → the challenge contract (code length, expiry, retryAfter). `pendingIntent` is the return path. */
  async sendOtp(phoneNumber: string, pendingIntent?: string): Promise<OtpChallengeResponse> {
    return apiClient.post<OtpChallengeResponse>('/accounts/otp/send', {
      phoneNumber,
      ...(pendingIntent ? { pendingIntent } : {}),
    });
  },

  async verifyOtp(phoneNumber: string, code: string, name?: string): Promise<VerifyOtpResponse> {
    const guestId = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const body = {
      phoneNumber,
      code,
      ...(guestId ? { guestId } : {}),
      ...(name?.trim() ? { name: name.trim() } : {}),
    };
    
    const response = await apiClient.post<VerifyOtpResponse>('/accounts/otp/verify', body);
    
    if (response.token) {
      localStorage.setItem(TOKEN_KEY, response.token);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('guestCartToken'); // clear after merge
      }
    }
    return response;
  },

  async logout(): Promise<void> {
    const token = this.getToken();
    if (token) {
      try {
        await apiClient.post('/accounts/logout', {}, { token });
      } finally {
        localStorage.removeItem(TOKEN_KEY);
      }
    }
  },

  async getMe(): Promise<User> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    return apiClient.get<User>('/accounts/me', { token });
  },

  async updateProfile(data: UpdateProfileInput): Promise<User> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    return apiClient.patch<User>('/accounts/me', data, { token });
  },

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};

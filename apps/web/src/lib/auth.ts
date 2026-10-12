import { apiClient } from './api-client';
import { SESSION_TOKEN_KEY } from './session-token';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  user: User;
  sessionToken: string;
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
    if (response.sessionToken) {
      localStorage.setItem(TOKEN_KEY, response.sessionToken);
    }
    return response;
  },

  async sendOtp(phoneNumber: string): Promise<void> {
    await apiClient.post('/accounts/otp/send', { phoneNumber });
  },

  async verifyOtp(phoneNumber: string, code: string): Promise<VerifyOtpResponse> {
    const guestId = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const body = { phoneNumber, code, ...(guestId ? { guestId } : {}) };
    
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

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};

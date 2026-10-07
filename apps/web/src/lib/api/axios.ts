import axios, { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { env } from '@/config/env';
import { normalizeApiError } from './errors';

export const apiClient = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('sessionToken');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error: AxiosError | Error) => Promise.reject(normalizeApiError(error))
);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError | Error) => {
    return Promise.reject(normalizeApiError(error));
  }
);

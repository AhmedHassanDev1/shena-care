import { AuthShell } from '@/features/auth/components/AuthShell';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In | ShenaCare',
  description: 'Sign in to your ShenaCare account',
};

export default function AuthLayout({ children }: { children: any }) {
  return <AuthShell>{children}</AuthShell>;
}

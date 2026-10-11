import { AuthShell } from '@/features/auth/components/AuthShell';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In | Shena Care',
  description: 'Sign in to your Shena Care account',
};

export default function AuthLayout({ children }: { children: any }) {
  return <AuthShell>{children}</AuthShell>;
}

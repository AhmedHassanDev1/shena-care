import type { Viewport } from 'next'

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b0b0e',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, User } from '@/lib/auth';
import Link from 'next/link';

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const me = await auth.getMe();
        setUser(me);
      } catch (err) {
        router.push('/auth/login');
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [router]);

  const handleLogout = async () => {
    await auth.logout();
    router.push('/');
  };

  if (loading) return <div className="loading">Loading account...</div>;
  if (!user) return null;

  return (
    <div className="account-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>My Account</h1>
      <p>Welcome, {user.name}!</p>
      
      <div className="account-grid" style={{ display: 'grid', gap: '1rem', marginTop: '2rem' }}>
        <Link href="/orders" className="account-card" style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Orders</h3>
          <p>View your order history and track deliveries.</p>
        </Link>
        
        <Link href="/account/profile" className="account-card" style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Care Profile</h3>
          <p>Update your skin profile and routine preferences.</p>
        </Link>

        <div className="account-card" style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Addresses</h3>
          <p>Manage your delivery addresses.</p>
        </div>
        
        <div className="account-card" style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Support</h3>
          <p>Get help with your routine or orders.</p>
        </div>
      </div>

      <button onClick={handleLogout} style={{ marginTop: '2rem', padding: '0.5rem 1rem', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
        Log Out
      </button>
    </div>
  );
}

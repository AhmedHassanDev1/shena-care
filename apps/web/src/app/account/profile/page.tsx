'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { care } from '@/lib/care';
import Link from 'next/link';

export default function CareProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [skinType, setSkinType] = useState('OILY');
  const [sensitivities, setSensitivities] = useState('');
  
  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await care.getProfile();
        if (data.skinType) setSkinType(data.skinType);
        if (data.sensitivities) setSensitivities(data.sensitivities);
      } catch (err) {
        // If profile doesn't exist, it's fine, we will create it
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      await care.updateProfile({ skinType, sensitivities });
      router.push('/account');
    } catch (err) {
      setError('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Loading profile...</div>;

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <Link href="/account" style={{ display: 'inline-block', marginBottom: '1rem', color: '#666' }}>
        ← Back to Account
      </Link>
      
      <h1>Care Profile</h1>
      <p style={{ marginBottom: '2rem' }}>Help us personalize your routine.</p>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label htmlFor="skinType"><strong>1. What is your skin type?</strong></label>
          <select 
            id="skinType" 
            value={skinType} 
            onChange={(e) => setSkinType(e.target.value)}
            style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
          >
            <option value="OILY">Oily</option>
            <option value="DRY">Dry</option>
            <option value="COMBINATION">Combination</option>
            <option value="NORMAL">Normal</option>
            <option value="SENSITIVE">Sensitive</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label htmlFor="sensitivities"><strong>2. Any known sensitivities? (Optional)</strong></label>
          <input
            id="sensitivities"
            type="text"
            value={sensitivities}
            onChange={(e) => setSensitivities(e.target.value)}
            placeholder="e.g. Fragrance, Niacinamide"
            style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <button 
            type="submit" 
            disabled={saving}
            style={{ padding: '0.75rem 2rem', background: '#000', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
          
          <button 
            type="button" 
            onClick={() => router.push('/account')}
            style={{ padding: '0.75rem 2rem', background: 'transparent', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}
          >
            Skip for now
          </button>
        </div>
      </form>
    </div>
  );
}

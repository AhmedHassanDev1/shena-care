'use client';

import { useState } from 'react';
import Link from 'next/link';

type CheckInState = 'idle' | 'checking_in' | 'done';

export default function MyRoutinePage() {
  const [checkInState, setCheckInState] = useState<CheckInState>('idle');
  const [replenishDismissed, setReplenishDismissed] = useState(false);

  // Mocked state - normally fetched from API
  const mockRoutine = {
    id: 'r_123',
    products: [
      { id: 'p_1', name: 'Gentle Hydrating Cleanser', step: 'Cleanse', stockStatus: 'in_stock', price: 15.00 },
      { id: 'p_2', name: 'Niacinamide Serum 10%', step: 'Treat', stockStatus: 'out_of_stock', price: 20.00 },
      { id: 'p_3', name: 'Daily SPF 50 Mineral Sunscreen', step: 'Protect', stockStatus: 'low_stock', price: 25.00 }
    ],
    lastCheckIn: '2023-10-15',
    dueForCheckIn: true,
    dueForReplenishment: true
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '2rem' }}>My Routine & Follow-ups</h1>

      {/* Check-In Card */}
      {mockRoutine.dueForCheckIn && checkInState !== 'done' && (
        <div style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--color-primary)', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--color-primary)' }}>●</span> Action Required: 14-Day Check-in
            </h2>
            <button 
              onClick={() => setCheckInState('done')}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-light)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Skip
            </button>
          </div>
          
          {checkInState === 'idle' ? (
            <div>
              <p style={{ color: 'var(--color-text-light)', marginBottom: '1rem' }}>
                How is your skin reacting to the Niacinamide Serum 10% so far?
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button className="cta-button" onClick={() => setCheckInState('checking_in')}>Great, no issues</button>
                <button className="cta-button" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={() => setCheckInState('checking_in')}>Slight redness</button>
                <button className="cta-button" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={() => setCheckInState('checking_in')}>I stopped using it</button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--color-text-light)', marginBottom: '1rem' }}>Thanks for the update! We've adjusted your timeline.</p>
              <button className="cta-button" onClick={() => setCheckInState('done')}>Done</button>
            </div>
          )}
        </div>
      )}

      {/* Replenishment/Reorder Card */}
      {mockRoutine.dueForReplenishment && !replenishDismissed && (
        <div style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--color-border)', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem' }}>Time to restock?</h2>
            <button 
              onClick={() => setReplenishDismissed(true)}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-light)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Snooze
            </button>
          </div>
          
          <p style={{ color: 'var(--color-text-light)', marginBottom: '1.5rem' }}>
            Based on average usage, you might be running low on these essentials.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--color-bg)', borderRadius: '0.5rem' }}>
              <div>
                <div style={{ fontWeight: 500 }}>Gentle Hydrating Cleanser</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>$15.00</div>
              </div>
              <button className="cta-button" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>Add to Cart</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--color-bg)', borderRadius: '0.5rem', border: '1px dashed var(--color-border)' }}>
              <div>
                <div style={{ fontWeight: 500, color: 'var(--color-text-light)' }}>Niacinamide Serum 10%</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>Out of stock</div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="cta-button" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}>Notify Me</button>
                <button className="cta-button" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>Find Alt.</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Routine Overview */}
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Current Routine</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {mockRoutine.products.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--color-surface)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase' }}>{p.step}</div>
              <div style={{ fontWeight: 500 }}>{p.name}</div>
            </div>
            <Link href={`/products/${p.id}`} style={{ fontSize: '0.9rem', color: 'var(--color-primary)', textDecoration: 'underline' }}>
              View Details
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

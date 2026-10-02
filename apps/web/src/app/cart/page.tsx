'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cart as cartApi, type Cart } from '@/lib/cart';
import { auth } from '@/lib/auth';

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);

  // We check for guest mode because cart can be guest-accessible in our updated flows
  const isGuest = !auth.isAuthenticated();

  useEffect(() => {
    loadCart();
  }, []);

  const loadCart = async () => {
    try {
      const data = await cartApi.getCart().catch(() => ({ items: [], total: 0, itemCount: 0, sessionId: '' } as Cart));
      setCart(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cart');
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = async (skuId: string, quantity: number) => {
    if (isGuest) return; // Mock behavior for guest
    setUpdatingItem(skuId);
    try {
      const updated = await cartApi.updateQuantity(skuId, quantity);
      setCart(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quantity');
    } finally {
      setUpdatingItem(null);
    }
  };

  const removeItem = async (skuId: string) => {
    if (isGuest) return; // Mock behavior for guest
    setUpdatingItem(skuId);
    try {
      const updated = await cartApi.removeFromCart(skuId);
      setCart(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove item');
    } finally {
      setUpdatingItem(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        <p style={{ marginTop: '1rem', color: 'var(--color-text-light)' }}>Loading cart...</p>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '6rem 1rem', maxWidth: '400px', margin: '0 auto' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛒</div>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Your cart is empty</h2>
        <p style={{ color: 'var(--color-text-light)', marginBottom: '2rem' }}>Looks like you haven't added anything yet. Discover our skincare collections to get started.</p>
        <button onClick={() => router.push('/products')} className="cta-button" style={{ width: '100%' }}>
          Browse Products
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '2rem' }}>Shopping Cart <span style={{ color: 'var(--color-text-light)', fontSize: '1.25rem', fontWeight: 400 }}>({cart.itemCount} items)</span></h1>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', alignItems: 'start' }}>
        
        {/* Items List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {cart.items.map((item) => {
            // Mock random unavailable state for UI demo if price is exactly a certain amount, or just assume all available
            const isUnavailable = false; 

            return (
              <div key={item.skuId} style={{ 
                display: 'flex', 
                gap: '1rem',
                background: 'var(--color-surface)', 
                padding: '1rem', 
                borderRadius: '0.75rem', 
                border: '1px solid var(--color-border)',
                opacity: isUnavailable ? 0.6 : 1,
                position: 'relative'
              }}>
                {/* Image Placeholder */}
                <div style={{ width: '80px', height: '80px', background: 'var(--color-bg-alt)', borderRadius: '0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  📦
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    {/* Context Tag */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '0.1rem 0.4rem', borderRadius: '1rem', marginBottom: '0.25rem', display: 'inline-block' }}>
                        ★ من روتينك (From Routine)
                      </span>
                      <button onClick={() => removeItem(item.skuId)} style={{ background: 'none', border: 'none', color: 'var(--color-text-light)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                    </div>

                    <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{item.sku.product.name}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', marginBottom: '0.25rem' }}>
                      {item.sku.variantName} {item.sku.size ? `- ${item.sku.size} ${item.sku.sizeUnit}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                    
                    {isUnavailable ? (
                      <div style={{ color: '#b45309', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>Out of Stock</span>
                        <button style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.75rem' }}>Find Replacement</button>
                      </div>
                    ) : (
                      <>
                        {/* Quantity Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-bg)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
                          <button 
                            onClick={() => updateQuantity(item.skuId, item.quantity - 1)}
                            disabled={item.quantity <= 1 || updatingItem === item.skuId}
                            style={{ padding: '0.25rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                          >-</button>
                          <span style={{ fontSize: '0.9rem', width: '20px', textAlign: 'center' }}>{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(item.skuId, item.quantity + 1)}
                            disabled={updatingItem === item.skuId}
                            style={{ padding: '0.25rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                          >+</button>
                        </div>
                        <div style={{ fontWeight: 600 }}>${item.subtotal?.toFixed(2) || '0.00'}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky Summary */}
        <div style={{ 
          background: 'var(--color-surface)', 
          padding: '1.5rem', 
          borderRadius: '1rem', 
          border: '1px solid var(--color-border)',
          position: 'sticky',
          top: '2rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Order Summary</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-light)' }}>Products ({cart.itemCount})</span>
              <span>${cart.total.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-light)' }}>Delivery</span>
              <span style={{ fontSize: '0.85rem' }}>Calculated at checkout</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--color-border)', paddingTop: '1rem', marginBottom: '1.5rem', fontWeight: 700, fontSize: '1.2rem' }}>
            <span>Total</span>
            <span>${cart.total.toFixed(2)}</span>
          </div>

          <button 
            onClick={() => router.push('/checkout')} 
            className="cta-button"
            style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}
          >
            Checkout Securely
          </button>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', color: 'var(--color-text-light)', fontSize: '0.8rem' }}>
            <span>🔒 Secure Payment</span>
            <span>|</span>
            <span>🚚 Free returns</span>
          </div>
        </div>
      </div>
    </div>
  );
}

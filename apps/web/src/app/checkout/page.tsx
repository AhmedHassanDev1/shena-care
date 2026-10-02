'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cart as cartApi, type Cart } from '@/lib/cart';
import { orders } from '@/lib/orders';
import { auth } from '@/lib/auth';

const GOVERNORATES = [
  { id: 'cairo', name: 'Cairo', fee: 50 },
  { id: 'alexandria', name: 'Alexandria', fee: 60 },
  { id: 'giza', name: 'Giza', fee: 55 },
  { id: 'other', name: 'Other Governorates', fee: 100 },
];

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    governorate: 'cairo',
    address: '',
    landmark: '',
  });

  const isGuest = !auth.isAuthenticated();

  useEffect(() => {
    loadCart();
  }, []);

  const loadCart = async () => {
    try {
      // In a real app, cart could be synced from local storage for guests
      const data = await cartApi.getCart().catch(() => {
        // Mock fallback for guests without server cart
        return { items: [], total: 0 } as Cart;
      });
      
      if (data.items.length === 0 && !isGuest) {
        router.push('/cart');
        return;
      }
      setCart(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cart');
    } finally {
      setLoading(false);
    }
  };

  const deliveryFee = GOVERNORATES.find(g => g.id === formData.governorate)?.fee || 0;
  const orderTotal = (cart?.total || 0) + deliveryFee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const fullAddress = `${GOVERNORATES.find(g => g.id === formData.governorate)?.name}, ${formData.address}${formData.landmark ? `, Landmark: ${formData.landmark}` : ''}`;
      
      const order = await orders.checkout({
        customerName: formData.customerName,
        customerPhone: formData.customerPhone,
        shippingAddress: fullAddress,
      }, isGuest);
      
      const url = order.guestToken ? `/orders/${order.id}?token=${order.guestToken}` : `/orders/${order.id}`;
      router.push(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="checkout-container">
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner"></div>
          <p style={{ marginTop: '1rem', color: 'var(--color-text-light)' }}>Loading checkout...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-container" style={{ maxWidth: '800px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
      <h1 className="page-title">Secure Checkout</h1>
      {isGuest && <p style={{ color: 'var(--color-text-light)', marginBottom: '1rem' }}>Checking out as a Guest.</p>}

      {error && <div className="error-message" style={{ background: '#fee2e2', color: '#991b1b', padding: '1rem', borderRadius: '0.5rem' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '2rem', alignItems: 'start' }}>
        
        {/* Left Column: Delivery & Payment */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          <div className="checkout-section" style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>1. Delivery Details</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>Full Name *</label>
                <input
                  type="text"
                  required
                  value={formData.customerName}
                  onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                  placeholder="Your full name"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>Mobile Number *</label>
                <input
                  type="tel"
                  required
                  value={formData.customerPhone}
                  onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                  placeholder="01xxxxxxxxx"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>Governorate / Area *</label>
                <select
                  required
                  value={formData.governorate}
                  onChange={(e) => setFormData({ ...formData, governorate: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
                >
                  {GOVERNORATES.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>Detailed Address *</label>
                <textarea
                  required
                  rows={3}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Street name, Building number, Floor, Apartment"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>Landmark (Optional)</label>
                <input
                  type="text"
                  value={formData.landmark}
                  onChange={(e) => setFormData({ ...formData, landmark: e.target.value })}
                  placeholder="e.g. Next to pharmacy"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}
                />
              </div>
            </div>
          </div>

          <div className="checkout-section" style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>2. Payment Method</h2>
            <div style={{
              padding: '1rem',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem'
            }}>
              <input type="radio" checked readOnly style={{ marginTop: '0.25rem' }} />
              <div>
                <div style={{ fontWeight: 600 }}>Cash on Delivery (COD)</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', marginTop: '0.25rem' }}>
                  Pay securely with cash when your order arrives. Other methods are coming soon.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Review */}
        <div className="checkout-section" style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', position: 'sticky', top: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Order Review</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            {cart?.items.length === 0 && <p style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>Cart is empty for this guest session demo.</p>}
            {cart?.items.map((item) => (
              <div key={item.skuId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', alignItems: 'center' }}>
                <div style={{ flex: 1, paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 500 }}>{item.sku.product.name}</div>
                  <div style={{ color: 'var(--color-text-light)', fontSize: '0.8rem' }}>Variant: {item.sku.variantName} | Qty: {item.quantity}</div>
                  <div style={{ color: 'var(--color-success)', fontSize: '0.75rem', fontWeight: 600 }}>✓ In Stock (Pending Confirmation)</div>
                </div>
                <div style={{ fontWeight: 500 }}>${item.subtotal?.toFixed(2) || '0.00'}</div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.95rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-light)' }}>Subtotal</span>
              <span>${(cart?.total || 0).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-light)' }}>Delivery Fee</span>
              <span>${deliveryFee.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.2rem', marginTop: '0.5rem' }}>
              <span>Total to Pay (COD)</span>
              <span>${orderTotal.toFixed(2)}</span>
            </div>
          </div>

          <button 
            type="submit" 
            className="cta-button" 
            disabled={submitting || (cart?.items.length === 0 && !isGuest)}
            style={{ width: '100%', marginTop: '2rem', padding: '1rem', fontSize: '1.05rem' }}
          >
            {submitting ? 'Placing Order...' : 'Place Order'}
          </button>
          
          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-light)', marginTop: '1rem' }}>
            By placing this order, you agree to our Terms of Service and Delivery Policies.
          </p>
        </div>
      </form>
    </div>
  );
}

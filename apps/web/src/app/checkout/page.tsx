'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cart as cartApi, type Cart } from '@/lib/cart';
import { orders } from '@/lib/orders';
import { auth } from '@/lib/auth';

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    shippingAddress: '',
  });

  useEffect(() => {
    if (!auth.isAuthenticated()) {
      router.push('/auth/login');
      return;
    }
    loadCart();
  }, []);

  const loadCart = async () => {
    try {
      const data = await cartApi.getCart();
      if (data.items.length === 0) {
        router.push('/cart');
        return;
      }
      setCart(data);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        router.push('/auth/login');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load cart');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const order = await orders.checkout(formData);
      router.push(`/orders/${order.id}`);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        router.push('/auth/login');
      } else {
        setError(err instanceof Error ? err.message : 'Checkout failed');
      }
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="checkout-container">
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>
      </div>
    );
  }

  if (!cart) {
    return null;
  }

  return (
    <div className="checkout-container">
      <h1 className="page-title">Checkout</h1>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="checkout-section">
          <h2>Delivery Information</h2>

          <div className="auth-form">
            <div className="form-field">
              <label htmlFor="customerName">Full Name *</label>
              <input
                id="customerName"
                type="text"
                required
                value={formData.customerName}
                onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                placeholder="Your full name"
              />
            </div>

            <div className="form-field">
              <label htmlFor="customerPhone">Phone Number *</label>
              <input
                id="customerPhone"
                type="tel"
                required
                value={formData.customerPhone}
                onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                placeholder="+1234567890"
              />
            </div>

            <div className="form-field">
              <label htmlFor="shippingAddress">Delivery Address *</label>
              <textarea
                id="shippingAddress"
                required
                rows={4}
                value={formData.shippingAddress}
                onChange={(e) => setFormData({ ...formData, shippingAddress: e.target.value })}
                placeholder="Street address, city, state, postal code"
              />
            </div>
          </div>
        </div>

        <div className="checkout-section">
          <h2>Payment Method</h2>
          <div style={{
            padding: 'var(--spacing-md)',
            background: 'var(--color-bg-alt)',
            borderRadius: '0.375rem',
            border: '1px solid var(--color-border)'
          }}>
            <strong>Cash on Delivery (COD)</strong>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-light)', marginTop: '0.25rem' }}>
              Pay with cash when your order is delivered
            </p>
          </div>
        </div>

        <div className="checkout-section">
          <h2>Order Summary</h2>
          <div className="order-details">
            {cart.items.map((item) => (
              <div key={item.skuId} className="order-summary-item">
                <span>
                  {item.sku.product.name} - {item.sku.variantName} (x{item.quantity})
                </span>
                <span>${item.subtotal?.toFixed(2) || '0.00'}</span>
              </div>
            ))}

            <div className="order-detail-row" style={{ marginTop: '1rem', paddingTop: '1rem', fontWeight: 600 }}>
              <span>Total</span>
              <span>${cart.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <button type="submit" className="checkout-button" disabled={submitting}>
          {submitting ? 'Placing order...' : 'Place Order'}
        </button>
      </form>
    </div>
  );
}

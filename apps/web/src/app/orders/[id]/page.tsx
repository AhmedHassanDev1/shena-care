'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orders, type Order } from '@/lib/orders';

export default function OrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrder();
  }, [params.id]);

  const loadOrder = async () => {
    try {
      const data = await orders.getOrder(params.id);
      setOrder(data);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        router.push('/auth/login');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load order');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="order-confirmation">
        <div>Loading order...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="order-confirmation">
        <div className="error-message">{error}</div>
        <a href="/products" className="cta-button" style={{ marginTop: '1.5rem' }}>
          Continue Shopping
        </a>
      </div>
    );
  }

  if (!order) {
    return null;
  }

  return (
    <div className="order-confirmation">
      <div className="success-icon">✓</div>

      <h1>Order Confirmed!</h1>
      <p className="order-number">Order #{order.orderNumber}</p>

      <div className="order-details">
        <div className="order-detail-row">
          <span className="order-detail-label">Status</span>
          <span style={{ textTransform: 'capitalize' }}>{order.status}</span>
        </div>

        <div className="order-detail-row">
          <span className="order-detail-label">Payment Method</span>
          <span>{order.paymentMethod}</span>
        </div>

        <div className="order-detail-row">
          <span className="order-detail-label">Delivery To</span>
          <span style={{ textAlign: 'right' }}>{order.customerName}</span>
        </div>

        <div className="order-detail-row">
          <span className="order-detail-label">Phone</span>
          <span>{order.customerPhone}</span>
        </div>

        <div className="order-detail-row">
          <span className="order-detail-label">Address</span>
          <span style={{ textAlign: 'right' }}>{order.shippingAddress}</span>
        </div>

        <div className="order-detail-row" style={{
          marginTop: '1rem',
          paddingTop: '1rem',
          fontWeight: 600,
          fontSize: '1.125rem'
        }}>
          <span>Total Amount</span>
          <span>{order.currency} {order.totalAmount.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Items Ordered</h3>
        <div style={{
          background: 'var(--color-bg-alt)',
          padding: 'var(--spacing-md)',
          borderRadius: '0.375rem',
          border: '1px solid var(--color-border)'
        }}>
          {order.items.map((item, index) => (
            <div key={index} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: 'var(--spacing-sm) 0',
              borderBottom: index < order.items.length - 1 ? '1px solid var(--color-border)' : 'none'
            }}>
              <span>
                {item.sku.product.name} - {item.sku.variantName} (x{item.quantity})
              </span>
              <span>${item.subtotal.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <p style={{
        marginTop: '2rem',
        color: 'var(--color-text-light)',
        maxWidth: '500px'
      }}>
        We'll prepare your order and contact you for delivery. Please have the exact amount ready for cash payment.
      </p>

      <a href="/products" className="cta-button" style={{ marginTop: '1.5rem' }}>
        Continue Shopping
      </a>
    </div>
  );
}

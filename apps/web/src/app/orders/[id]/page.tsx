'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { orders, type Order } from '@/lib/orders';

const STATUS_STAGES = [
  { id: 'placed', label: 'Order Received' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'packing', label: 'Preparing' },
  { id: 'shipped', label: 'Out for Delivery' },
  { id: 'delivered', label: 'Delivered' },
];

export default function OrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrder();
  }, [params.id, searchParams]);

  const loadOrder = async () => {
    try {
      const guestToken = searchParams.get('token') || undefined;
      const data = await orders.getOrder(params.id, guestToken);
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
      <div className="order-confirmation" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <div className="spinner"></div>
        <div style={{ marginTop: '1rem', color: 'var(--color-text-light)' }}>Loading order details...</div>
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

  if (!order) return null;

  const currentStageIndex = STATUS_STAGES.findIndex(s => s.id === order.status);
  const isCancelled = order.status === 'cancelled';
  const requiresAction = order.status === 'action_required'; // Pseudo-status for UI

  return (
    <div className="order-confirmation" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
      
      {/* Header section */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {order.status === 'placed' && (
          <>
            <div className="success-icon" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>🕒</div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Order Received</h1>
            <p style={{ color: 'var(--color-text-light)' }}>We've received your order and are confirming item availability.</p>
          </>
        )}
        {order.status === 'confirmed' && (
          <>
            <div className="success-icon" style={{ background: '#dcfce7', color: '#166534' }}>✓</div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Order Confirmed!</h1>
            <p style={{ color: 'var(--color-text-light)' }}>All items are secured and your order is being prepared.</p>
          </>
        )}
        {isCancelled && (
          <>
            <div className="success-icon" style={{ background: '#fee2e2', color: '#991b1b' }}>✕</div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Order Cancelled</h1>
          </>
        )}
      </div>

      <div style={{ background: 'var(--color-surface)', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Order #{order.orderNumber}</h2>
        
        {/* Timeline */}
        {!isCancelled && !requiresAction && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '2px', background: 'var(--color-border)', zIndex: 0 }}></div>
            <div style={{ position: 'absolute', top: '15px', left: '10%', right: `${100 - (Math.max(0, currentStageIndex) / (STATUS_STAGES.length - 1)) * 100}%`, height: '2px', background: 'var(--color-primary)', zIndex: 1, transition: 'right 0.5s ease' }}></div>
            
            {STATUS_STAGES.map((stage, idx) => {
              const isPast = currentStageIndex >= idx;
              const isCurrent = currentStageIndex === idx;
              return (
                <div key={stage.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, width: '20%' }}>
                  <div style={{ 
                    width: '30px', height: '30px', borderRadius: '50%', 
                    background: isPast ? 'var(--color-primary)' : 'var(--color-surface)',
                    border: `2px solid ${isPast ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    color: isPast ? 'white' : 'var(--color-text-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '0.5rem', fontSize: '0.8rem', fontWeight: 'bold'
                  }}>
                    {isPast ? '✓' : idx + 1}
                  </div>
                  <span style={{ fontSize: '0.75rem', textAlign: 'center', color: isCurrent ? 'var(--color-text)' : 'var(--color-text-light)', fontWeight: isCurrent ? 600 : 400 }}>
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Action Required Alert */}
        {requiresAction && (
          <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '0.5rem', padding: '1rem', marginBottom: '2rem' }}>
            <h3 style={{ color: '#92400e', marginBottom: '0.5rem' }}>⚠️ Action Required: Partial Availability</h3>
            <p style={{ color: '#b45309', fontSize: '0.9rem', marginBottom: '1rem' }}>One or more items in your order are currently unavailable. Please choose how you'd like to proceed.</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={{ padding: '0.5rem 1rem', background: '#d97706', color: 'white', borderRadius: '0.25rem', border: 'none', cursor: 'pointer' }}>View Alternatives</button>
              <button style={{ padding: '0.5rem 1rem', background: 'transparent', color: '#92400e', border: '1px solid #d97706', borderRadius: '0.25rem', cursor: 'pointer' }}>Continue Without Items</button>
            </div>
          </div>
        )}

        {/* ETA Section */}
        <div style={{ background: 'var(--color-bg-alt)', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '1.5rem', marginRight: '1rem' }}>🚚</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Estimated Delivery</div>
            <div style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
              {order.status === 'placed' ? 'Will be calculated upon availability confirmation' : '1-2 Business Days'}
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
          <div>
            <div style={{ color: 'var(--color-text-light)', marginBottom: '0.25rem' }}>Delivery Address</div>
            <div style={{ fontWeight: 500 }}>{order.customerName}</div>
            <div>{order.shippingAddress}</div>
            <div style={{ color: 'var(--color-text-light)' }}>{order.customerPhone}</div>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-light)', marginBottom: '0.25rem' }}>Payment Method</div>
            <div style={{ fontWeight: 500 }}>{order.paymentMethod === 'cod' ? 'Cash on Delivery' : order.paymentMethod}</div>
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--color-surface)', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Items Ordered</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {order.items.map((item, index) => (
            <div key={index} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: index < order.items.length - 1 ? '1rem' : '0',
              borderBottom: index < order.items.length - 1 ? '1px solid var(--color-border)' : 'none'
            }}>
              <div>
                <div style={{ fontWeight: 500 }}>{item.sku.product.name}</div>
                <div style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>Variant: {item.sku.variantName} | Qty: {item.quantity}</div>
              </div>
              <div style={{ fontWeight: 600 }}>{order.currency} {item.subtotal.toFixed(2)}</div>
            </div>
          ))}
        </div>
        
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px dashed var(--color-border)', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.1rem' }}>
          <span>Total Amount</span>
          <span>{order.currency} {order.totalAmount.toFixed(2)}</span>
        </div>
      </div>

      {order.status === 'placed' && (
        <p style={{ marginTop: '2rem', color: 'var(--color-text-light)', fontSize: '0.85rem', textAlign: 'center' }}>
          You will receive an update once your items are confirmed by our suppliers.
        </p>
      )}

      <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
        Need help? <a href={`/support?orderId=${order.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Contact Support</a>
      </div>

      <div style={{ textAlign: 'center', marginTop: '2rem' }}>
        <a href="/products" className="cta-button" style={{ display: 'inline-block', textDecoration: 'none' }}>
          Continue Shopping
        </a>
      </div>
    </div>
  );
}

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

  const updateQuantity = async (skuId: string, quantity: number) => {
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

  const clearCart = async () => {
    if (!confirm('Are you sure you want to clear your cart?')) return;
    try {
      await cartApi.clearCart();
      setCart({ sessionId: cart?.sessionId || '', items: [], total: 0, itemCount: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cart');
    }
  };

  if (loading) {
    return (
      <div className="cart-container">
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading cart...</div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="cart-container">
        <div className="cart-empty">
          <h2>Your cart is empty</h2>
          <p>Add some products to get started</p>
          <a href="/products" className="cta-button">
            Browse Products
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Shopping Cart</h1>
        {cart.items.length > 0 && (
          <button onClick={clearCart} className="remove-button">
            Clear Cart
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="cart-items">
        {cart.items.map((item) => (
          <div key={item.skuId} className="cart-item">
            <div className="cart-item-details">
              <div className="cart-item-brand">{item.sku.product.brand.name}</div>
              <div className="cart-item-name">{item.sku.product.name}</div>
              <div className="cart-item-variant">{item.sku.variantName}</div>
              {item.sku.size && (
                <div className="cart-item-variant">
                  {item.sku.size} {item.sku.sizeUnit}
                </div>
              )}

              <div className="cart-item-actions">
                <div className="quantity-control">
                  <button
                    onClick={() => updateQuantity(item.skuId, item.quantity - 1)}
                    disabled={item.quantity <= 1 || updatingItem === item.skuId}
                  >
                    -
                  </button>
                  <span>{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.skuId, item.quantity + 1)}
                    disabled={updatingItem === item.skuId}
                  >
                    +
                  </button>
                </div>

                <button
                  onClick={() => removeItem(item.skuId)}
                  className="remove-button"
                  disabled={updatingItem === item.skuId}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="cart-item-price">
              ${item.subtotal?.toFixed(2) || '0.00'}
            </div>
          </div>
        ))}
      </div>

      <div className="cart-summary">
        <div className="cart-summary-row">
          <span>Subtotal ({cart.itemCount} items)</span>
          <span>${cart.total.toFixed(2)}</span>
        </div>
        <div className="cart-summary-row total">
          <span>Total</span>
          <span>${cart.total.toFixed(2)}</span>
        </div>

        <button
          onClick={() => router.push('/checkout')}
          className="checkout-button"
        >
          Proceed to Checkout
        </button>
      </div>
    </div>
  );
}

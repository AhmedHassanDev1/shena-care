const API_BASE = 'http://localhost:3001';

async function testE2EFlow() {
  console.log('=== Starting E2E Purchase Flow Test ===\n');

  let accessToken;
  let customerId;
  let skuId;
  let cartItemId;
  let orderId;

  // Step 1: Register
  console.log('1. Register new customer...');
  try {
    const testEmail = `test${Date.now()}@example.com`;
    const registerRes = await fetch(`${API_BASE}/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Test User',
        email: testEmail,
        password: 'Test@1234'
      })
    });

    if (!registerRes.ok) {
      const error = await registerRes.text();
      throw new Error(`Register failed: ${registerRes.status} - ${error}`);
    }

    const registerData = await registerRes.json();
    accessToken = registerData.token;
    console.log(`✓ Registered with token: ${accessToken.substring(0, 20)}...\n`);
  } catch (err) {
    console.error(`✗ Register failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 2: Get product listings
  console.log('2. Fetch product listings...');
  try {
    const listingsRes = await fetch(`${API_BASE}/commerce/listings?page=1&limit=10`);

    if (!listingsRes.ok) {
      throw new Error(`Listings failed: ${listingsRes.status}`);
    }

    const listingsData = await listingsRes.json();
    if (!listingsData.items || listingsData.items.length === 0) {
      throw new Error('No products available');
    }

    skuId = listingsData.items[0].skuId;
    console.log(`✓ Found ${listingsData.items.length} products, selected skuId=${skuId}\n`);
  } catch (err) {
    console.error(`✗ Listings failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 3: Get product detail
  console.log('3. Fetch product detail...');
  try {
    const detailRes = await fetch(`${API_BASE}/commerce/listings/${skuId}`);

    if (!detailRes.ok) {
      throw new Error(`Product detail failed: ${detailRes.status}`);
    }

    const productDetail = await detailRes.json();
    console.log(`✓ Product: ${productDetail.product?.name || 'N/A'}, Price: ${productDetail.currentPrice || 'N/A'}\n`);
  } catch (err) {
    console.error(`✗ Product detail failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 4: Add to cart
  console.log('4. Add product to cart...');
  try {
    const addToCartRes = await fetch(`${API_BASE}/ordering/cart/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        productId: productId,
        quantity: 2
      })
    });

    if (!addToCartRes.ok) {
      const error = await addToCartRes.text();
      throw new Error(`Add to cart failed: ${addToCartRes.status} - ${error}`);
    }

    const cartData = await addToCartRes.json();
    cartItemId = cartData.items?.[0]?.id;
    console.log(`✓ Added to cart: ${cartData.items?.length || 0} items, total: ${cartData.total || 'N/A'}\n`);
  } catch (err) {
    console.error(`✗ Add to cart failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 5: Update cart quantity
  console.log('5. Update cart quantity...');
  try {
    const updateQtyRes = await fetch(`${API_BASE}/ordering/cart/quantity`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        cartItemId: cartItemId,
        quantity: 3
      })
    });

    if (!updateQtyRes.ok) {
      const error = await updateQtyRes.text();
      throw new Error(`Update quantity failed: ${updateQtyRes.status} - ${error}`);
    }

    const updatedCart = await updateQtyRes.json();
    console.log(`✓ Updated quantity: total now ${updatedCart.total || 'N/A'}\n`);
  } catch (err) {
    console.error(`✗ Update quantity failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 6: Checkout with COD
  console.log('6. Checkout with COD payment...');
  try {
    const checkoutRes = await fetch(`${API_BASE}/ordering/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        paymentMethod: 'COD',
        shippingAddress: {
          street: '123 Test St',
          city: 'Cairo',
          governorate: 'Cairo',
          postalCode: '11511'
        }
      })
    });

    if (!checkoutRes.ok) {
      const error = await checkoutRes.text();
      throw new Error(`Checkout failed: ${checkoutRes.status} - ${error}`);
    }

    const orderData = await checkoutRes.json();
    orderId = orderData.orderId || orderData.id;
    console.log(`✓ Order created: orderId=${orderId}, status=${orderData.status || 'N/A'}\n`);
  } catch (err) {
    console.error(`✗ Checkout failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 7: Fetch order confirmation
  console.log('7. Fetch order confirmation...');
  try {
    const orderRes = await fetch(`${API_BASE}/ordering/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!orderRes.ok) {
      throw new Error(`Fetch order failed: ${orderRes.status}`);
    }

    const order = await orderRes.json();
    console.log(`✓ Order confirmed: ${order.lineItems?.length || 0} items, total: ${order.total || 'N/A'}\n`);
  } catch (err) {
    console.error(`✗ Fetch order failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 8: Test failure case - invalid login
  console.log('8. Test failure case: invalid login...');
  try {
    const badLoginRes = await fetch(`${API_BASE}/accounts/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@example.com',
        password: 'WrongPassword'
      })
    });

    if (badLoginRes.ok) {
      throw new Error('Bad login should have failed but succeeded');
    }

    console.log(`✓ Invalid login correctly rejected with status ${badLoginRes.status}\n`);
  } catch (err) {
    console.error(`✗ Failure case test error: ${err.message}\n`);
    process.exit(1);
  }

  console.log('=== E2E Purchase Flow: ALL TESTS PASSED ===');
  process.exit(0);
}

testE2EFlow().catch(err => {
  console.error('\n=== FATAL ERROR ===');
  console.error(err);
  process.exit(1);
});

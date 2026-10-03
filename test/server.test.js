const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, createStore } = require('../server');

async function withServer(run) {
  const server = await startServer(0, createStore());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function api(baseUrl, path, options = {}, token = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { status: response.status, body };
}

test('user can search, add to cart, checkout, and view order history', async () => {
  await withServer(async (baseUrl) => {
    const login = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'alice123' })
    });
    assert.equal(login.status, 200);
    const token = login.body.token;

    const products = await api(baseUrl, '/api/products?search=lap&category=Electronics', { method: 'GET' });
    assert.equal(products.status, 200);
    assert.equal(products.body.products.length, 1);

    const add = await api(baseUrl, '/api/cart/add', {
      method: 'POST',
      body: JSON.stringify({ productId: 1, quantity: 2 })
    }, token);
    assert.equal(add.status, 200);
    assert.equal(add.body.cart[0].quantity, 2);

    const checkout = await api(baseUrl, '/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ paymentMethod: 'card' })
    }, token);
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.order.paymentStatus, 'simulated-success');

    const orders = await api(baseUrl, '/api/orders', { method: 'GET' }, token);
    assert.equal(orders.status, 200);
    assert.equal(orders.body.orders.length, 1);
  });
});

test('admin can add and edit products, user cannot access admin endpoints', async () => {
  await withServer(async (baseUrl) => {
    const userLogin = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'alice123' })
    });

    const forbidden = await api(baseUrl, '/api/admin/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'Desk', category: 'Home', price: 120, stock: 4, description: 'Wood desk' })
    }, userLogin.body.token);
    assert.equal(forbidden.status, 403);

    const adminLogin = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(adminLogin.status, 200);

    const addProduct = await api(baseUrl, '/api/admin/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'Desk', category: 'Home', price: 120, stock: 4, description: 'Wood desk' })
    }, adminLogin.body.token);
    assert.equal(addProduct.status, 201);

    const updated = await api(baseUrl, `/api/admin/products/${addProduct.body.product.id}`, {
      method: 'PUT',
      body: JSON.stringify({ price: 110.5 })
    }, adminLogin.body.token);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.product.price, 110.5);
  });
});

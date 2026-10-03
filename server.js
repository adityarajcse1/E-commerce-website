const http = require('http');
const { readFileSync } = require('fs');
const { randomUUID } = require('crypto');
const { URL } = require('url');
const path = require('path');

const indexHtml = readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

function createStore() {
  return {
    users: [
      { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
      { id: 2, username: 'alice', password: 'alice123', role: 'user' }
    ],
    products: [
      { id: 1, name: 'Laptop', category: 'Electronics', price: 999.99, stock: 8, description: 'Portable workstation' },
      { id: 2, name: 'Coffee Mug', category: 'Home', price: 12.5, stock: 100, description: 'Ceramic mug' },
      { id: 3, name: 'Running Shoes', category: 'Sports', price: 79.99, stock: 25, description: 'Comfort for daily runs' }
    ],
    carts: new Map(),
    orders: [],
    sessions: new Map()
  };
}

function send(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function toPublicUser(user) {
  return { id: user.id, username: user.username, role: user.role };
}

function sanitizeProductInput(input, partial = false) {
  const next = {};
  if (!partial || Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim()) return null;
    next.name = input.name.trim();
  }
  if (!partial || Object.hasOwn(input, 'category')) {
    if (typeof input.category !== 'string' || !input.category.trim()) return null;
    next.category = input.category.trim();
  }
  if (!partial || Object.hasOwn(input, 'description')) {
    if (typeof input.description !== 'string' || !input.description.trim()) return null;
    next.description = input.description.trim();
  }
  if (!partial || Object.hasOwn(input, 'price')) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    next.price = Number(price.toFixed(2));
  }
  if (!partial || Object.hasOwn(input, 'stock')) {
    const stock = Number(input.stock);
    if (!Number.isInteger(stock) || stock < 0) return null;
    next.stock = stock;
  }
  return next;
}

function createApp(store = createStore()) {
  function currentUser(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const userId = store.sessions.get(token);
    if (!userId) return null;
    return store.users.find((u) => u.id === userId) || null;
  }

  function requireUser(req, res) {
    const user = currentUser(req);
    if (!user) {
      send(res, 401, { error: 'Authentication required' });
      return null;
    }
    return user;
  }

  function requireAdmin(req, res) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (user.role !== 'admin') {
      send(res, 403, { error: 'Admin access required' });
      return null;
    }
    return user;
  }

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, 'http://localhost');
    const { pathname, searchParams } = reqUrl;

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
      return;
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!username || password.length < 4) {
          send(res, 400, { error: 'Username and password (min 4 chars) are required' });
          return;
        }
        if (store.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
          send(res, 409, { error: 'Username already exists' });
          return;
        }
        const user = { id: store.users.length + 1, username, password, role: 'user' };
        store.users.push(user);
        send(res, 201, { user: toPublicUser(user) });
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const user = store.users.find((u) => u.username === username && u.password === password);
        if (!user) {
          send(res, 401, { error: 'Invalid credentials' });
          return;
        }
        const token = randomUUID();
        store.sessions.set(token, user.id);
        send(res, 200, { token, user: toPublicUser(user) });
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return;
    }

    if (pathname === '/api/products' && req.method === 'GET') {
      const search = (searchParams.get('search') || '').trim().toLowerCase();
      const category = (searchParams.get('category') || '').trim().toLowerCase();
      const products = store.products.filter((p) => {
        const matchesSearch = !search || p.name.toLowerCase().includes(search) || p.description.toLowerCase().includes(search);
        const matchesCategory = !category || p.category.toLowerCase() === category;
        return matchesSearch && matchesCategory;
      });
      send(res, 200, { products });
      return;
    }

    if (pathname === '/api/cart' && req.method === 'GET') {
      const user = requireUser(req, res);
      if (!user) return;
      const cart = store.carts.get(user.id) || [];
      send(res, 200, { cart });
      return;
    }

    if (pathname === '/api/cart/add' && req.method === 'POST') {
      const user = requireUser(req, res);
      if (!user) return;
      try {
        const body = await parseBody(req);
        const productId = Number(body.productId);
        const quantity = Number(body.quantity);
        if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
          send(res, 400, { error: 'Valid productId and quantity are required' });
          return;
        }
        const product = store.products.find((p) => p.id === productId);
        if (!product) {
          send(res, 404, { error: 'Product not found' });
          return;
        }
        if (product.stock < quantity) {
          send(res, 400, { error: 'Insufficient stock' });
          return;
        }
        const cart = store.carts.get(user.id) || [];
        const existing = cart.find((item) => item.productId === productId);
        if (existing) {
          if (existing.quantity + quantity > product.stock) {
            send(res, 400, { error: 'Insufficient stock' });
            return;
          }
          existing.quantity += quantity;
        } else {
          cart.push({ productId, name: product.name, price: product.price, quantity });
        }
        store.carts.set(user.id, cart);
        send(res, 200, { cart });
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return;
    }

    if (pathname === '/api/checkout' && req.method === 'POST') {
      const user = requireUser(req, res);
      if (!user) return;
      try {
        const body = await parseBody(req);
        if (typeof body.paymentMethod !== 'string' || !body.paymentMethod.trim()) {
          send(res, 400, { error: 'paymentMethod is required' });
          return;
        }
        const cart = store.carts.get(user.id) || [];
        if (!cart.length) {
          send(res, 400, { error: 'Cart is empty' });
          return;
        }
        for (const item of cart) {
          const product = store.products.find((p) => p.id === item.productId);
          if (!product || product.stock < item.quantity) {
            send(res, 400, { error: `Insufficient stock for ${item.name}` });
            return;
          }
        }
        cart.forEach((item) => {
          const product = store.products.find((p) => p.id === item.productId);
          product.stock -= item.quantity;
        });
        const total = Number(cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
        const order = {
          id: store.orders.length + 1,
          userId: user.id,
          items: cart,
          total,
          paymentMethod: body.paymentMethod.trim(),
          paymentStatus: 'simulated-success',
          orderedAt: new Date().toISOString()
        };
        store.orders.push(order);
        store.carts.set(user.id, []);
        send(res, 201, { order });
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return;
    }

    if (pathname === '/api/orders' && req.method === 'GET') {
      const user = requireUser(req, res);
      if (!user) return;
      const orders = store.orders.filter((o) => o.userId === user.id);
      send(res, 200, { orders });
      return;
    }

    if (pathname === '/api/admin/products' && req.method === 'POST') {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      try {
        const body = await parseBody(req);
        const productInput = sanitizeProductInput(body);
        if (!productInput) {
          send(res, 400, { error: 'Invalid product data' });
          return;
        }
        const product = { id: store.products.length + 1, ...productInput };
        store.products.push(product);
        send(res, 201, { product });
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return;
    }

    if (pathname.startsWith('/api/admin/products/') && req.method === 'PUT') {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const productId = Number(pathname.split('/').pop());
      const product = store.products.find((p) => p.id === productId);
      if (!product) {
        send(res, 404, { error: 'Product not found' });
        return;
      }
      try {
        const body = await parseBody(req);
        const updates = sanitizeProductInput(body, true);
        if (!updates || !Object.keys(updates).length) {
          send(res, 400, { error: 'Invalid product updates' });
          return;
        }
        Object.assign(product, updates);
        send(res, 200, { product });
      } catch (err) {
        send(res, 400, { error: err.message });
      }
      return;
    }

    send(res, 404, { error: 'Not found' });
  });
}

function startServer(port = Number(process.env.PORT) || 3000, store) {
  const server = createApp(store);
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  startServer().then(() => {
    console.log('E-commerce app running on http://localhost:3000');
  });
}

module.exports = { createApp, createStore, startServer };

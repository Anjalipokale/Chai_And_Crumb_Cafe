require('dotenv').config();
const express = require('express'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const helmet = require('helmet'), cors = require('cors'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const db = require('./db');

const { PORT = 3000, JWT_SECRET, PAYMENT_SECRET, SITE_URL = 'http://localhost:3000', CORS_ORIGIN = '' } = process.env;
if (!JWT_SECRET || !PAYMENT_SECRET) { console.error('JWT_SECRET and PAYMENT_SECRET must be set (see .env.example)'); process.exit(1); }
const PINS = (process.env.SERVICE_PINCODES || '414001').split(',').map(s => s.trim());
const FEE = +process.env.DELIVERY_FEE || 30, FREE = +process.env.FREE_DELIVERY_ABOVE || 500;
const MOCK_ON = process.env.ENABLE_MOCK_PAYMENT !== 'false';
const BIZ = { name: process.env.BUSINESS_NAME || 'Café', city: process.env.BUSINESS_CITY || '', address: process.env.BUSINESS_ADDRESS || '', phone: process.env.BUSINESS_PHONE || '' };
db.seed();

const app = express();
app.set('trust proxy', 1);
const csp = helmet.contentSecurityPolicy.getDefaultDirectives(); delete csp['upgrade-insecure-requests'];
app.use(helmet({ contentSecurityPolicy: { directives: csp } }));
app.use(cors({ origin: CORS_ORIGIN ? CORS_ORIGIN.split(',').map(s => s.trim()) : false }));
app.use(express.json({ limit: '50kb' }));

const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const STAGES = ['Placed', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'];
const FLOW = { Placed: ['Accepted', 'Cancelled'], Accepted: ['Preparing', 'Cancelled'], Preparing: ['Ready', 'Cancelled'], 'Out for Delivery': ['Delivered', 'Cancelled'], Delivered: [], Cancelled: [] };
const nextOf = o => o.status === 'Ready' ? [o.type === 'delivery' ? 'Out for Delivery' : 'Delivered', 'Cancelled'] : FLOW[o.status];
const sign = s => crypto.createHmac('sha256', PAYMENT_SECRET).update(s).digest('hex');
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

// ---------- auth ----------
const fails = new Map(); // naive in-memory login throttle: 8 failures / 15 min / IP
app.post('/api/auth/login', (req, res) => {
  const hits = (fails.get(req.ip) || []).filter(t => Date.now() - t < 9e5);
  if (hits.length >= 8) throw bad('Too many attempts. Try again in a few minutes.', 429);
  const { email, password } = req.body || {};
  const u = typeof email === 'string' && typeof password === 'string' && db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) { fails.set(req.ip, [...hits, Date.now()]); throw bad('Invalid email or password', 401); }
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
});
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); } catch { throw bad('Please log in', 401); }
  if (!roles.includes(req.user.role)) throw bad('You do not have access to this', 403);
  next();
};

// ---------- pricing (server is the only source of truth) ----------
function quote(items, type, pincode) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw bad('Your cart is empty');
  let subtotal = 0; const lines = [];
  for (const i of items) {
    const qty = Number(i.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw bad('Quantity must be between 1 and 20');
    const m = db.prepare('SELECT * FROM menu_items WHERE id=? AND active=1').get(Number(i.id));
    if (!m) throw bad('An item in your cart is no longer available');
    lines.push({ id: m.id, name: m.name, price: m.price, qty }); subtotal += m.price * qty;
  }
  let deliveryFee = 0;
  if (type === 'delivery') {
    if (!/^\d{6}$/.test(String(pincode || '').trim())) throw bad('Enter your 6-digit pincode');
    if (!PINS.includes(String(pincode).trim())) throw bad('Sorry, we do not deliver to this pincode yet. Choose pickup instead.');
    deliveryFee = subtotal >= FREE ? 0 : FEE;
  } else if (type !== 'pickup') throw bad('Choose pickup or delivery');
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

// ---------- public API ----------
const menuRows = () => db.prepare('SELECT id,category,name,description,price FROM menu_items WHERE active=1 ORDER BY category,id').all();
app.get('/api/menu', (req, res) => res.json(menuRows()));
app.post('/api/quote', (req, res) => { const b = req.body || {}; res.json(quote(b.items, b.type, b.pincode)); });

app.post('/api/orders', (req, res) => {
  const { name, phone, type, address, pincode, items } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2) throw bad('Enter your name');
  if (!/^[6-9]\d{9}$/.test(String(phone || ''))) throw bad('Enter a valid 10-digit mobile number');
  if (type === 'delivery' && (typeof address !== 'string' || address.trim().length < 5)) throw bad('Enter your delivery address');
  const q = quote(items, type, pincode);
  const ref = 'ORD-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  db.transaction(() => {
    const id = db.prepare(`INSERT INTO orders(ref,customer_name,phone,type,address,pincode,subtotal,delivery_fee,total) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(ref, name.trim().slice(0, 80), phone, type, type === 'delivery' ? address.trim().slice(0, 300) : null, type === 'delivery' ? String(pincode).trim() : null, q.subtotal, q.deliveryFee, q.total).lastInsertRowid;
    q.lines.forEach(l => db.prepare('INSERT INTO order_items(order_id,menu_item_id,name,price,qty) VALUES(?,?,?,?,?)').run(id, l.id, l.name, l.price, l.qty));
    db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(id, 'Placed', 'Order placed by customer');
  })();
  res.status(201).json({ ref, total: q.total, paymentToken: sign('init|' + ref) });
});

const getRow = ref => db.prepare('SELECT o.*, u.name AS rider FROM orders o LEFT JOIN users u ON u.id=o.assigned_to WHERE o.ref=?').get(ref);
function present(o, staff) {
  const items = db.prepare('SELECT name,price,qty FROM order_items WHERE order_id=?').all(o.id);
  const ev = db.prepare('SELECT e.status,e.note,e.at,u.name AS staff FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.order_id=? ORDER BY e.id').all(o.id);
  const out = { ref: o.ref, customer_name: o.customer_name, type: o.type, status: o.status, payment_status: o.payment_status, subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total, created_at: o.created_at, items,
    events: ev.map(e => ({ status: e.status, at: e.at, ...(staff ? { by: e.staff || 'customer', note: e.note } : {}) })) };
  if (staff) Object.assign(out, { phone: o.phone, address: o.address, pincode: o.pincode, assigned_to: o.assigned_to, rider: o.rider, next: nextOf(o) });
  return out;
}
// Customers track with the unguessable reference only; phone/address are never returned here.
app.get('/api/orders/:ref', (req, res) => { const o = getRow(req.params.ref); if (!o) throw bad('Order not found', 404); res.json(present(o, false)); });

// ---------- payment (mock gateway that mirrors Razorpay's signature verification) ----------
app.post('/api/mock-gateway/charge', (req, res) => {
  if (!MOCK_ON) throw bad('Mock payments are disabled', 404);
  const { ref, outcome, token } = req.body || {};
  if (!['success', 'failure', 'pending'].includes(outcome)) throw bad('Invalid outcome');
  if (!safeEq(token || '', sign('init|' + ref))) throw bad('Invalid payment session', 403);
  const paymentId = 'mock_' + crypto.randomBytes(6).toString('hex');
  res.json({ paymentId, status: outcome, signature: sign(`${ref}|${paymentId}|${outcome}`) });
});
app.post('/api/orders/:ref/verify-payment', (req, res) => {
  const o = getRow(req.params.ref); if (!o) throw bad('Order not found', 404);
  const { paymentId, status, signature } = req.body || {};
  if (!safeEq(signature || '', sign(`${o.ref}|${paymentId}|${status}`))) throw bad('Payment signature could not be verified', 400);
  if (o.payment_status === 'Paid') return res.json({ payment_status: 'Paid' }); // idempotent
  const map = { success: 'Paid', failure: 'Failed', pending: 'Pending' };
  if (!map[status]) throw bad('Unknown payment status');
  db.prepare('UPDATE orders SET payment_status=?, payment_id=? WHERE id=?').run(map[status], paymentId, o.id);
  res.json({ payment_status: map[status] });
});

// ---------- staff: orders ----------
const sel = 'SELECT o.*, u.name AS rider FROM orders o LEFT JOIN users u ON u.id=o.assigned_to';
app.get('/api/admin/orders', auth('admin'), (req, res) => res.json(db.prepare(sel + ' ORDER BY o.id DESC LIMIT 100').all().map(o => present(o, true))));
app.get('/api/delivery/orders', auth('delivery'), (req, res) => res.json(db.prepare(sel + ' WHERE o.assigned_to=? ORDER BY o.id DESC').all(req.user.id).map(o => present(o, true))));
app.get('/api/admin/delivery-members', auth('admin'), (req, res) => res.json(db.prepare("SELECT id,name FROM users WHERE role='delivery'").all()));

app.patch('/api/orders/:ref/status', auth('admin', 'delivery'), (req, res) => {
  const o = getRow(req.params.ref); if (!o) throw bad('Order not found', 404);
  const { status, note } = req.body || {};
  if (!STAGES.includes(status)) throw bad('Unknown status');
  if (req.user.role === 'delivery') {
    if (o.assigned_to !== req.user.id) throw bad('This order is not assigned to you', 403);
    if (!['Out for Delivery', 'Delivered'].includes(status)) throw bad('Delivery members can only mark Out for Delivery or Delivered', 403);
  }
  if (!nextOf(o).includes(status)) throw bad(`An order that is ${o.status} cannot move to ${status}`);
  if (status === 'Out for Delivery' && !o.assigned_to) throw bad('Assign a delivery member first');
  db.transaction(() => {
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, o.id);
    db.prepare('INSERT INTO order_events(order_id,status,user_id,note) VALUES(?,?,?,?)').run(o.id, status, req.user.id, typeof note === 'string' ? note.slice(0, 200) : null);
  })();
  res.json(present(getRow(o.ref), true));
});
app.patch('/api/orders/:ref/assign', auth('admin'), (req, res) => {
  const o = getRow(req.params.ref); if (!o) throw bad('Order not found', 404);
  if (o.type !== 'delivery') throw bad('Only delivery orders can be assigned');
  if (['Delivered', 'Cancelled'].includes(o.status)) throw bad('This order is already closed');
  const rider = db.prepare("SELECT id,name FROM users WHERE id=? AND role='delivery'").get(Number(req.body && req.body.userId));
  if (!rider) throw bad('Choose a valid delivery member');
  db.prepare('UPDATE orders SET assigned_to=? WHERE id=?').run(rider.id, o.id);
  db.prepare('INSERT INTO order_events(order_id,status,user_id,note) VALUES(?,?,?,?)').run(o.id, o.status, req.user.id, 'Assigned to ' + rider.name);
  res.json(present(getRow(o.ref), true));
});

// ---------- staff: menu ----------
function menuInput(b, partial) {
  const o = {};
  if (!partial || b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim()) throw bad('Item name is required'); o.name = b.name.trim().slice(0, 80); }
  if (!partial || b.category !== undefined) { if (typeof b.category !== 'string' || !b.category.trim()) throw bad('Category is required'); o.category = b.category.trim().slice(0, 40); }
  if (!partial || b.price !== undefined) { if (!Number.isInteger(+b.price) || +b.price < 1 || +b.price > 100000) throw bad('Price must be a whole number of rupees'); o.price = +b.price; }
  if (b.description !== undefined) o.description = String(b.description).slice(0, 300);
  if (b.active !== undefined) o.active = b.active ? 1 : 0;
  return o;
}
app.get('/api/admin/menu', auth('admin'), (req, res) => res.json(db.prepare('SELECT * FROM menu_items ORDER BY category,id').all()));
app.post('/api/admin/menu', auth('admin'), (req, res) => {
  const v = menuInput(req.body || {}, false);
  const id = db.prepare('INSERT INTO menu_items(category,name,description,price) VALUES(?,?,?,?)').run(v.category, v.name, v.description || '', v.price).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM menu_items WHERE id=?').get(id));
});
app.put('/api/admin/menu/:id', auth('admin'), (req, res) => {
  const cur = db.prepare('SELECT id FROM menu_items WHERE id=?').get(+req.params.id); if (!cur) throw bad('Item not found', 404);
  const v = menuInput(req.body || {}, true), keys = Object.keys(v);
  if (keys.length) db.prepare(`UPDATE menu_items SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`).run(...keys.map(k => v[k]), cur.id);
  res.json(db.prepare('SELECT * FROM menu_items WHERE id=?').get(cur.id));
});

// ---------- pages & SEO ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG = { 'Coffee & Tea': 'coffee', Snacks: 'snacks', Meals: 'meals', Desserts: 'desserts' };
const base = SITE_URL.replace(/\/$/, '');
app.get('/', (req, res) => {
  const cats = {}; menuRows().forEach(m => (cats[m.category] = cats[m.category] || []).push(m));
  const menu = Object.entries(cats).map(([c, items]) => `<section class="cat" aria-labelledby="c-${esc(IMG[c] || c.length)}"><h2 id="c-${esc(IMG[c] || c.length)}">${esc(c)}</h2><ul class="items">` +
    items.map(m => `<li class="item"><img src="/img/${IMG[c] || 'snacks'}.svg" width="72" height="72" loading="lazy" alt="${esc(m.name)} from our ${esc(c)} menu"><div class="info"><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p></div><div class="buy"><span class="price">₹${m.price}</span><button type="button" data-add="${m.id}" data-name="${esc(m.name)}" data-price="${m.price}" aria-label="Add ${esc(m.name)} to cart">Add</button></div></li>`).join('') + '</ul></section>').join('');
  const ld = { '@context': 'https://schema.org', '@type': 'CafeOrCoffeeShop', name: BIZ.name, url: base + '/', servesCuisine: ['Cafe', 'Indian', 'Snacks'], acceptsReservations: false,
    address: { '@type': 'PostalAddress', streetAddress: BIZ.address, addressLocality: BIZ.city, addressCountry: 'IN' }, hasMenu: base + '/#menu' };
  if (BIZ.phone) ld.telephone = BIZ.phone;
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replace(/{{NAME}}/g, esc(BIZ.name)).replace(/{{CITY}}/g, esc(BIZ.city)).replace(/{{CANONICAL}}/g, base + '/').replace('{{MENU}}', menu)
    .replace('{{JSONLD}}', JSON.stringify(ld).replace(/</g, '\\u003c')).replace('{{PINS}}', esc(PINS.join(', ')));
  res.type('html').send(html);
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /track/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/track/:ref', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') err = bad('Invalid JSON');
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on our side' : err.message });
});
if (require.main === module) app.listen(PORT, () => console.log(`Café app running on ${base} (port ${PORT})`));
module.exports = app;

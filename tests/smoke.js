process.env.DB_PATH = require('os').tmpdir() + '/cafe-test-' + Date.now() + '.db';
process.env.JWT_SECRET = 't'; process.env.PAYMENT_SECRET = 'p'; process.env.SERVICE_PINCODES = '414001';
const app = require('../server'), assert = require('assert');
const srv = app.listen(0, async () => {
  const B = 'http://localhost:' + srv.address().port;
  const j = async (p, m = 'GET', body, tk) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: body && JSON.stringify(body) }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
  try {
    const menu = (await j('/api/menu')).d; assert(menu.length >= 10);
    const o = await j('/api/orders', 'POST', { name: 'Test', phone: '9876543210', type: 'delivery', address: '12 Test Road', pincode: '414001', items: [{ id: menu[0].id, qty: 2, price: 1 }], total: 1 });
    assert.equal(o.s, 201); assert.equal(o.d.total, menu[0].price * 2 + 30, 'server computes total');
    assert.equal((await j('/api/quote', 'POST', { items: [{ id: menu[0].id, qty: 1 }], type: 'delivery', pincode: '999999' })).s, 400);
    assert.equal((await j('/api/admin/orders')).s, 401);
    const ch = (await j('/api/mock-gateway/charge', 'POST', { ref: o.d.ref, outcome: 'success', token: o.d.paymentToken })).d;
    assert.equal((await j(`/api/orders/${o.d.ref}/verify-payment`, 'POST', { ...ch, signature: 'bad' })).s, 400);
    assert.equal((await j(`/api/orders/${o.d.ref}/verify-payment`, 'POST', ch)).d.payment_status, 'Paid');
    const a = (await j('/api/auth/login', 'POST', { email: 'admin@cafe.test', password: 'Admin@123' })).d.token;
    const r = (await j('/api/auth/login', 'POST', { email: 'rider1@cafe.test', password: 'Rider@123' })).d;
    assert.equal((await j('/api/admin/orders', 'GET', null, r.token)).s, 403);
    for (const s of ['Accepted', 'Preparing', 'Ready']) assert.equal((await j(`/api/orders/${o.d.ref}/status`, 'PATCH', { status: s }, a)).s, 200);
    assert.equal((await j(`/api/orders/${o.d.ref}/status`, 'PATCH', { status: 'Out for Delivery' }, a)).s, 400, 'needs rider');
    assert.equal((await j(`/api/orders/${o.d.ref}/assign`, 'PATCH', { userId: r.user.id }, a)).s, 200);
    assert.equal((await j(`/api/orders/${o.d.ref}/status`, 'PATCH', { status: 'Out for Delivery' }, r.token)).s, 200);
    assert.equal((await j(`/api/orders/${o.d.ref}/status`, 'PATCH', { status: 'Delivered' }, r.token)).s, 200);
    assert.equal((await j(`/api/orders/${o.d.ref}`)).d.phone, undefined, 'public view hides phone');
    console.log('All smoke tests passed');
  } catch (e) { console.error('FAILED:', e); process.exitCode = 1; } finally { srv.close(); }
});

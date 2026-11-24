let token = sessionStorage.getItem('tk'), user = JSON.parse(sessionStorage.getItem('us') || 'null'), tab = 'orders', riders = [], editing = null;
const call = (p, o) => api(p, o, token);
function out() { sessionStorage.clear(); token = user = null; start(); }
$('#logout').onclick = out;
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  try { const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#pw').value } });
    token = r.token; user = r.user; sessionStorage.setItem('tk', token); sessionStorage.setItem('us', JSON.stringify(user)); start();
  } catch (err) { $('#lerr').textContent = err.message; }
});
async function start() {
  $('#login').hidden = !!token; $('#app').hidden = !token; $('#logout').hidden = !token; $('#who').textContent = user ? `${user.name} (${user.role})` : '';
  if (token) { if (user.role === 'admin') riders = await call('/api/admin/delivery-members').catch(() => []); draw(); }
}
async function act(fn) { try { await fn(); } catch (e) { if (e.status === 401) return out(); alert(e.message); } draw(); }

async function draw() {
  const isAdmin = user.role === 'admin', app = $('#app');
  const tabs = h('div', { class: 'tabs' }, h('button', { 'aria-pressed': String(tab === 'orders'), onclick: () => { tab = 'orders'; draw(); } }, isAdmin ? 'Orders' : 'My deliveries'),
    isAdmin && h('button', { 'aria-pressed': String(tab === 'menu'), onclick: () => { tab = 'menu'; draw(); } }, 'Menu'));
  try { app.replaceChildren(tabs, tab === 'menu' && isAdmin ? await menuView() : await ordersView(isAdmin)); }
  catch (e) { if (e.status === 401) out(); else app.replaceChildren(tabs, h('p', { class: 'err' }, e.message)); }
}
async function ordersView(isAdmin) {
  const orders = await call(isAdmin ? '/api/admin/orders' : '/api/delivery/orders');
  if (!orders.length) return h('p', { class: 'muted' }, 'No orders yet.');
  return h('div', { class: 'grid' }, orders.map(o => {
    const steps = o.next.filter(s => isAdmin || ['Out for Delivery', 'Delivered'].includes(s));
    return h('article', { class: 'card' },
      h('div', { class: 'row' }, h('strong', {}, o.ref), h('span', { class: 'badge' }, o.status)),
      h('div', {}, `${o.customer_name} · ${o.phone} · ${o.type}${o.type === 'delivery' ? ' · ' + o.address + ' ' + o.pincode : ''}`),
      h('div', {}, o.items.map(i => `${i.name} × ${i.qty}`).join(', ')),
      h('div', {}, `Total ${rs(o.total)} · Payment: ${o.payment_status}` + (o.rider ? ` · Rider: ${o.rider}` : '')),
      h('div', { class: 'muted' }, 'History: ' + o.events.map(e => `${e.status} (${e.by})`).join(' → ')),
      h('div', { class: 'actions' },
        steps.map(s => h('button', { class: s === 'Cancelled' ? 'danger' : '', onclick: () => act(() => call(`/api/orders/${o.ref}/status`, { method: 'PATCH', body: { status: s } })) }, s === 'Cancelled' ? (o.status === 'Placed' ? 'Reject' : 'Cancel') : s === 'Accepted' ? 'Accept' : 'Mark ' + s)),
        isAdmin && o.type === 'delivery' && !['Delivered', 'Cancelled'].includes(o.status) && h('select', { 'aria-label': 'Assign delivery member', onchange: e => e.target.value && act(() => call(`/api/orders/${o.ref}/assign`, { method: 'PATCH', body: { userId: +e.target.value } })) },
          h('option', { value: '' }, o.rider ? 'Reassign…' : 'Assign rider…'), riders.map(r => h('option', { value: r.id }, r.name)))));
  }));
}
async function menuView() {
  const items = await call('/api/admin/menu'), e = editing || {};
  const form = h('form', { class: 'card', onsubmit: ev => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); act(async () => {
      await call(e.id ? '/api/admin/menu/' + e.id : '/api/admin/menu', { method: e.id ? 'PUT' : 'POST', body: f }); editing = null; }); } },
    h('h2', {}, e.id ? 'Edit item' : 'Add item'),
    h('label', { for: 'mn' }, 'Name'), h('input', { id: 'mn', name: 'name', required: true, value: e.name || '' }),
    h('label', { for: 'mc' }, 'Category'), h('input', { id: 'mc', name: 'category', required: true, value: e.category || '', list: 'cats' }),
    h('datalist', { id: 'cats' }, ['Coffee & Tea', 'Snacks', 'Meals', 'Desserts'].map(c => h('option', { value: c }))),
    h('label', { for: 'mp' }, 'Price (₹)'), h('input', { id: 'mp', name: 'price', type: 'number', min: '1', required: true, value: e.price || '' }),
    h('label', { for: 'md' }, 'Description'), h('input', { id: 'md', name: 'description', value: e.description || '' }),
    h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save item'), e.id && h('button', { type: 'button', class: 'ghost', onclick: () => { editing = null; draw(); } }, 'Cancel')));
  return h('div', { class: 'grid' }, form, ...items.map(i => h('div', { class: 'card row' },
    h('span', {}, `${i.name} · ${i.category} · ${rs(i.price)}${i.active ? '' : ' (disabled)'}`),
    h('span', { class: 'actions' }, h('button', { class: 'ghost', onclick: () => { editing = i; draw(); } }, 'Edit'),
      h('button', { class: i.active ? 'danger' : '', onclick: () => act(() => call('/api/admin/menu/' + i.id, { method: 'PUT', body: { active: !i.active } })) }, i.active ? 'Disable' : 'Enable')))));
}
start();

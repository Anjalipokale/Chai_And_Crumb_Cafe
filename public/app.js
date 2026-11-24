let cart = [];
try { cart = JSON.parse(localStorage.getItem('cart') || '[]'); } catch {}
const save = () => { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {} render(); };

document.addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const id = +b.dataset.add, f = cart.find(i => i.id === id);
  f ? f.qty = Math.min(20, f.qty + 1) : cart.push({ id, name: b.dataset.name, price: +b.dataset.price, qty: 1 }); save();
});
function change(id, d) { const i = cart.find(x => x.id === id); i.qty += d; cart = cart.filter(x => x.qty > 0); save(); }

function render() {
  const box = $('#lines');
  box.replaceChildren(...(cart.length ? cart.map(i => h('div', { class: 'row' },
    h('span', {}, i.name),
    h('span', { class: 'qty' },
      h('button', { type: 'button', class: 'ghost', 'aria-label': 'Remove one ' + i.name, onclick: () => change(i.id, -1) }, '−'),
      h('span', {}, String(i.qty)),
      h('button', { type: 'button', class: 'ghost', 'aria-label': 'Add one ' + i.name, onclick: () => change(i.id, 1) }, '+')))) :
    [h('p', { class: 'muted' }, 'Your cart is empty. Add something from the menu.')]));
  $('#co').hidden = !cart.length;
  if (cart.length) quote();
}
async function quote() {
  const f = new FormData($('#co')), type = f.get('type'), box = $('#summary');
  $('#dfields').hidden = type !== 'delivery';
  try {
    const q = await api('/api/quote', { method: 'POST', body: { items: cart.map(({ id, qty }) => ({ id, qty })), type, pincode: f.get('pincode') } });
    box.replaceChildren(
      ...q.lines.map(l => h('div', { class: 'row' }, `${l.name} × ${l.qty}`, h('span', {}, rs(l.price * l.qty)))),
      h('div', { class: 'row' }, 'Subtotal', h('span', {}, rs(q.subtotal))),
      h('div', { class: 'row' }, 'Delivery fee', h('span', {}, rs(q.deliveryFee))),
      h('div', { class: 'row total' }, 'Total to pay', h('span', {}, rs(q.total))));
    $('#place').disabled = false;
  } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); $('#place').disabled = true; }
}
$('#co').addEventListener('input', quote);
$('#co').addEventListener('submit', async e => {
  e.preventDefault(); $('#formerr').textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('/api/orders', { method: 'POST', body: { ...f, items: cart.map(({ id, qty }) => ({ id, qty })) } });
    sessionStorage.setItem('pay_' + r.ref, r.paymentToken);
    cart = []; save(); location.href = '/track/' + r.ref;
  } catch (err) { $('#formerr').textContent = err.message; }
});
render();

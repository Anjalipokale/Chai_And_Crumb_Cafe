const ref = decodeURIComponent(location.pathname.split('/').pop());
async function pay(outcome) {
  try {
    const g = await api('/api/mock-gateway/charge', { method: 'POST', body: { ref, outcome, token: sessionStorage.getItem('pay_' + ref) } });
    await api(`/api/orders/${ref}/verify-payment`, { method: 'POST', body: g });
  } catch (e) { alert(e.message); }
  load();
}
function show(o) {
  const token = sessionStorage.getItem('pay_' + ref);
  $('#order').replaceChildren(
    h('h1', {}, 'Order ' + o.ref), h('p', {}, 'Status: ', h('span', { class: 'badge' }, o.status), '  Payment: ', o.payment_status),
    o.payment_status !== 'Paid' && token && h('div', { class: 'card' }, h('h2', {}, 'Mock payment'),
      h('p', { class: 'muted' }, 'Test mode. No real money is charged.'),
      h('div', { class: 'actions' }, h('button', { onclick: () => pay('success') }, 'Pay ' + rs(o.total)), h('button', { class: 'ghost', onclick: () => pay('failure') }, 'Simulate failure'), h('button', { class: 'ghost', onclick: () => pay('pending') }, 'Simulate pending'))),
    h('h2', {}, 'Items'), ...o.items.map(i => h('div', { class: 'row' }, `${i.name} × ${i.qty}`, h('span', {}, rs(i.price * i.qty)))),
    h('div', { class: 'row' }, 'Subtotal', h('span', {}, rs(o.subtotal))), h('div', { class: 'row' }, 'Delivery fee', h('span', {}, rs(o.delivery_fee))),
    h('div', { class: 'row total' }, o.type === 'delivery' ? 'Total (delivery)' : 'Total (pickup)', h('span', {}, rs(o.total))),
    h('h2', {}, 'Progress'), h('ul', { class: 'timeline' }, ...o.events.map(e => h('li', {}, `${e.status} · ${e.at} UTC`))),
    h('p', { class: 'muted' }, 'Keep this page link to check your order later. It refreshes automatically.'));
}
async function load() { try { show(await api('/api/orders/' + encodeURIComponent(ref))); } catch (e) { $('#order').replaceChildren(h('p', { class: 'err' }, e.message)); } }
load(); setInterval(load, 20000);

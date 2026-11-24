const Database = require('better-sqlite3'), fs = require('fs'), path = require('path');
const bcrypt = require('bcryptjs'), crypto = require('crypto');
const file = process.env.DB_PATH || path.join(__dirname, 'data', 'cafe.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','delivery')));
CREATE TABLE IF NOT EXISTS menu_items(
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '',
  price INTEGER NOT NULL CHECK(price > 0), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('pickup','delivery')), address TEXT, pincode TEXT,
  subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL, total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Placed', payment_status TEXT NOT NULL DEFAULT 'Pending', payment_id TEXT,
  assigned_to INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id INTEGER REFERENCES menu_items(id), name TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_events(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), status TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id), note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_orders_assigned ON orders(assigned_to);
`);

db.seed = () => {
  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
    const u = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)');
    u.run('Café Admin', 'admin@cafe.test', bcrypt.hashSync('Admin@123', 10), 'admin');
    u.run('Rahul (Rider)', 'rider1@cafe.test', bcrypt.hashSync('Rider@123', 10), 'delivery');
    u.run('Sneha (Rider)', 'rider2@cafe.test', bcrypt.hashSync('Rider@123', 10), 'delivery');
  }
  if (!db.prepare('SELECT COUNT(*) c FROM menu_items').get().c) {
    const m = db.prepare('INSERT INTO menu_items(category,name,description,price) VALUES(?,?,?,?)');
    [['Coffee & Tea','Masala Chai','Ginger and cardamom chai, brewed strong.',40],
     ['Coffee & Tea','Cappuccino','Double shot espresso with steamed milk foam.',120],
     ['Coffee & Tea','Cold Coffee','Blended coffee with milk and ice.',140],
     ['Coffee & Tea','Lemon Iced Tea','Black tea, lemon and mint.',100],
     ['Snacks','Veg Grilled Sandwich','Grilled with green chutney and cheese.',130],
     ['Snacks','Vada Pav','Mumbai-style potato vada in a soft pav.',35],
     ['Snacks','Peri Peri Fries','Crisp fries tossed in peri peri seasoning.',110],
     ['Meals','Paneer Wrap','Spiced paneer, onions and mint mayo in a wrap.',160],
     ['Meals','Veg Pasta','Penne in creamy white sauce with vegetables.',210],
     ['Meals','Masala Maggi','Our spicy take on the classic.',90],
     ['Desserts','Brownie','Warm chocolate brownie.',120],
     ['Desserts','Cheesecake Slice','Baked blueberry cheesecake.',180]].forEach(r => m.run(...r));
  }
  if (!db.prepare('SELECT COUNT(*) c FROM orders').get().c) {
    const FEE = +process.env.DELIVERY_FEE || 30, FREE = +process.env.FREE_DELIVERY_ABOVE || 500;
    const menu = db.prepare('SELECT * FROM menu_items ORDER BY id').all();
    const riders = db.prepare("SELECT id FROM users WHERE role='delivery' ORDER BY id").all();
    const mk = (name, phone, type, address, pincode, picks, status, pay, rider) => {
      const lines = picks.map(([i, q]) => ({ ...menu[i], qty: q }));
      const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
      const fee = type === 'delivery' && sub < FREE ? FEE : 0;
      const ref = 'ORD-' + crypto.randomBytes(5).toString('hex').toUpperCase();
      const id = db.prepare(`INSERT INTO orders(ref,customer_name,phone,type,address,pincode,subtotal,delivery_fee,total,status,payment_status,assigned_to)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(ref, name, phone, type, address, pincode, sub, fee, sub + fee, status, pay, rider || null).lastInsertRowid;
      lines.forEach(l => db.prepare('INSERT INTO order_items(order_id,menu_item_id,name,price,qty) VALUES(?,?,?,?,?)').run(id, l.id, l.name, l.price, l.qty));
      db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(id, 'Placed', 'Seed data');
    };
    mk('Amit Patil', '9876543210', 'pickup', null, null, [[0, 2], [5, 2]], 'Placed', 'Paid');
    mk('Priya Deshmukh', '9123456780', 'delivery', 'Flat 4, Savedi Road', '414003', [[8, 1], [1, 2]], 'Preparing', 'Paid');
    mk('Rohan Shinde', '9988776655', 'delivery', 'Station Road, Near Bus Stand', '414001', [[7, 2], [10, 1]], 'Out for Delivery', 'Paid', riders[0].id);
  }
};
module.exports = db;

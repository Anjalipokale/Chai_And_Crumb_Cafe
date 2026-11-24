require('dotenv').config();
require('./db').seed();
console.log('Seed complete. Admin: admin@cafe.test / Admin@123 | Rider: rider1@cafe.test / Rider@123');

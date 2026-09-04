const fs = require('fs');

let js = fs.readFileSync('assets/js/pages/admin_stats.js', 'utf8');

js = js.replace('collection(db, "k_culture_balances")', 'collection(db, "users")');

fs.writeFileSync('assets/js/pages/admin_stats.js', js, 'utf8');

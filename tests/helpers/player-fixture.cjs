// Game tests provision funded accounts independently of the public signup flow.
// Signup, CAPTCHA and its quota remain covered by clicker.integration.test.js.
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');
const path = require('node:path');
async function createPlayerFixture(baseUrl, dataDir, credentials, chips = 1000) {
  const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
  db.configure('busyTimeout', 5000);
  try {
    const hash = await bcrypt.hash(credentials.password, 4);
    await new Promise((resolve, reject) => db.run('INSERT INTO users (username, password_hash, chips) VALUES (?, ?, ?)',
      [credentials.username, hash, chips], error => error ? reject(error) : resolve()));
  } finally { await new Promise(resolve => db.close(resolve)); }
  const login = await fetch(`${baseUrl}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
  if (!login.ok) throw new Error(await login.text());
  const body = await login.json();
  const response = new Response(JSON.stringify(body), { status: 201, headers: login.headers });
  return { response, status: 201, body, cookie: login.headers.get('set-cookie')?.split(';')[0] };
}
module.exports = { createPlayerFixture };

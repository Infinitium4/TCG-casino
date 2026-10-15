const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('screen time starts once, pauses hidden tabs, renders totals, and stops before logout', async () => {
  const events = {}, intervals = new Map(), requests = [], elements = new Map();
  let nextId = 0;
  const context = vm.createContext({
    crypto: { randomUUID: () => 'test-tab-00000001' },
    window: { addEventListener(name, callback) { events[name] = callback; } },
    document: { hidden: false,
      addEventListener(name, callback) { events[name] = callback; },
      getElementById(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); }
    },
    setInterval(callback) { const id = ++nextId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    fetch: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ todaySeconds: 125, totalSeconds: 3725 }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../underground/js/screen-time.js'), 'utf8'), context);
  const module = context.window.screenTimeModule;
  module.start({ supportMode: true });
  assert.equal(intervals.size, 0);
  module.start({}); module.start({});
  await new Promise(setImmediate);
  assert.equal(intervals.size, 1);
  assert.equal(requests.length, 1);
  assert.equal(elements.get('screenTimeToday').textContent, '2 min');
  assert.equal(elements.get('screenTimeTotal').textContent, '1 h 2 min');
  context.document.hidden = true;
  await events.visibilitychange();
  assert.equal(requests.at(-1).active, false);
  const count = requests.length;
  [...intervals.values()][0]();
  await new Promise(setImmediate);
  assert.equal(requests.length, count);
  context.document.hidden = false;
  await events.visibilitychange();
  assert.equal(requests.at(-1).active, true);
  await module.stop();
  assert.equal(requests.at(-1).active, false);
  assert.equal(intervals.size, 0);
});

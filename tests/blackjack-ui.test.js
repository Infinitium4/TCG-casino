const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('a refresh started before an action cannot overwrite the confirmed hand', async () => {
  let resolveResponse;
  const context = vm.createContext({
    window: { location: { pathname: '/blackjack/game/test' } },
    document: { addEventListener() {} },
    console,
    fetch: () => new Promise(resolve => { resolveResponse = resolve; })
  });
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/blackjack-game.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize };', 'globalThis.game = { state, refreshTable }; return { initialize };'), context);
  const refresh = context.game.refreshTable();
  context.game.state.actionPending = true;
  context.game.state.requestVersion += 1;
  const confirmed = { players: [{ activeHand: 1 }] };
  context.game.state.table = confirmed;
  context.game.state.actionPending = false;
  resolveResponse({ ok: true, json: async () => ({ table: { players: [{ activeHand: 0 }] } }) });
  await refresh;
  assert.equal(context.game.state.table, confirmed);
});

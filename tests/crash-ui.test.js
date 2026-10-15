const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('cashout stops the flight and keeps confirmed winnings through later round updates', () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '25', textContent: '', attributes: {}, classes: new Set(),
      classList: {
        toggle(name, enabled) { enabled ? elements.get(id).classes.add(name) : elements.get(id).classes.delete(name); },
        remove(...names) { names.forEach(name => elements.get(id).classes.delete(name)); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      append() {}, replaceChildren() {}
    });
    return elements.get(id);
  };
  let nextFrame = 0;
  const frames = new Map();
  const context = vm.createContext(Object.assign({}, require('../underground/js/money'), {
    document: { hidden: false, getElementById: element, querySelectorAll: () => [], createElement: () => element(`new-${elements.size}`) },
    window: {}, Date, Number, Math, console,
    getPlayer: () => ({ chips: 1000 }), formatChips: String,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  }));
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/crash.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize,', 'globalThis.flight = { updateState, setActive, animate }; return { initialize,'), context);
  const round = { id: 'round-one', status: 'running', serverNow: Date.now(), startedAt: Date.now() - 1000, crashAt: Date.now() + 60000, multiplier: 1.5 };
  const active = { id: 'bet-one', status: 'active', stake: 25 };
  const update = (ownBet, nextRound = round) => context.flight.updateState({ round: nextRound, ownBet, balance: 1000, bets: [], history: [] });
  update(active);
  context.flight.setActive(true);
  assert.equal(frames.size, 1);
  const frameId = [...frames.keys()][0];
  const callback = frames.get(frameId);
  frames.delete(frameId);
  callback();
  const rocketPosition = element('crashAircraft').attributes.transform;
  const cashout = { ...active, status: 'cashed_out', cashoutMultiplier: 1.5, payout: 37 };
  update(cashout);
  assert.equal(frames.size, 0);
  assert.equal(element('crashPhaseLabel').textContent, 'Gains retirés');
  assert.equal(element('crashMultiplier').textContent, '1.50x');
  assert.equal(element('crashPotential').textContent, '37 €');
  update(active, { ...round, serverNow: Date.now() + 10, multiplier: 3 });
  assert.equal(frames.size, 0, 'a delayed active update cannot restart a confirmed cashout');
  update(cashout, { ...round, serverNow: Date.now() + 20, status: 'crashed', crashMultiplier: 4 });
  assert.equal(element('crashMultiplier').textContent, '1.50x');
  assert.equal(element('crashAircraft').attributes.transform, rocketPosition);
  assert.equal(element('crashSky').classes.has('is-crashed'), false);
  update({ ...active, id: 'bet-two' }, { ...round, id: 'round-two', status: 'betting', startedAt: Date.now() + 8000, bettingEndsAt: Date.now() + 8000 });
  assert.equal(frames.size, 1, 'a new game starts a new flight');
  assert.equal(element('crashSky').classes.has('is-cashed-out'), false);
});

const crypto = require('node:crypto');

const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAPTCHA_TTL_MS = 2 * 60 * 1000;
const CAPTCHA_MAX_ATTEMPTS = 5;
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110']
};

async function initializeRegistrationCaptcha(run, all) {
  const columns = await all('PRAGMA table_info(registration_captchas)');
  if (columns.length && !columns.some(column => column.name === 'answer_hash')) {
    await run('DROP TABLE registration_captchas');
  }
  await run(`CREATE TABLE IF NOT EXISTS registration_captchas (
    session_id TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    answer_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
  )`);
}

function randomCode() {
  return Array.from({ length: 6 }, () => CAPTCHA_ALPHABET[crypto.randomInt(CAPTCHA_ALPHABET.length)]).join('');
}

function glyphPath(character) {
  return GLYPHS[character].flatMap((row, rowIndex) => Array.from(row, (pixel, columnIndex) =>
    pixel === '1' ? `M${columnIndex * 6 + 1} ${rowIndex * 8 + 1}h4v6h-4z` : null
  ).filter(Boolean)).join('');
}

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function createCaptchaImage(code) {
  const backgrounds = ['#f3eee2', '#e9f0ea', '#f1e9e7', '#e9edf2'];
  const background = backgrounds[crypto.randomInt(backgrounds.length)];
  const noiseColors = ['#9a574c', '#587368', '#796b91', '#a07a39'];
  const noise = [];
  for (let index = 0; index < 5; index++) {
    const startX = randomInt(0, 280);
    const startY = randomInt(0, 84);
    const endX = randomInt(0, 280);
    const endY = randomInt(0, 84);
    noise.push(`<path d="M${startX} ${startY}L${endX} ${endY}" stroke="${noiseColors[crypto.randomInt(noiseColors.length)]}" stroke-width="${randomInt(1, 2)}" opacity="0.38"/>`);
  }
  for (let index = 0; index < 18; index++) {
    noise.push(`<circle cx="${randomInt(2, 278)}" cy="${randomInt(2, 82)}" r="${randomInt(1, 2)}" fill="${noiseColors[crypto.randomInt(noiseColors.length)]}" opacity="0.35"/>`);
  }
  const characters = Array.from(code, (character, index) => {
    const x = 21 + index * 40 + randomInt(-2, 2);
    const y = 12 + randomInt(-2, 2);
    const rotation = randomInt(-13, 13);
    const scale = (randomInt(9, 11) / 10).toFixed(1);
    const color = ['#263b46', '#713f38', '#334f40', '#4e4268'][crypto.randomInt(4)];
    return `<g transform="translate(${x} ${y}) rotate(${rotation} 15 28) scale(${scale})"><path d="${glyphPath(character)}" fill="${color}"/></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 84" width="280" height="84"><rect width="280" height="84" rx="5" fill="${background}"/>${noise.join('')}${characters}</svg>`;
}

function createRegistrationCaptcha({ run, get, withDatabaseTransaction, secret, now = Date.now, generateCode = randomCode }) {
  function hashAnswer(sessionId, id, answer) {
    return crypto.createHmac('sha256', secret).update(`${sessionId}:${id}:${answer}`).digest();
  }

  return {
    async issue(sessionId) {
      const answer = generateCode();
      const id = crypto.randomBytes(24).toString('hex');
      const expiresAt = now() + CAPTCHA_TTL_MS;
      await withDatabaseTransaction(async () => {
        await run('DELETE FROM registration_captchas WHERE expires_at <= ?', [now()]);
        await run(`INSERT OR REPLACE INTO registration_captchas
          (session_id, id, answer_hash, attempts, expires_at) VALUES (?, ?, ?, 0, ?)`,
        [sessionId, id, hashAnswer(sessionId, id, answer), expiresAt]);
      });
      const svg = createCaptchaImage(answer);
      return { id, image: `data:image/svg+xml,${encodeURIComponent(svg)}` };
    },
    async consume(sessionId, id, answer) {
      return withDatabaseTransaction(async () => {
        const challenge = await get('SELECT * FROM registration_captchas WHERE session_id = ?', [sessionId]);
        if (!challenge || challenge.id !== id) return { status: 'not_found' };
        if (challenge.expires_at <= now()) {
          await run('DELETE FROM registration_captchas WHERE session_id = ?', [sessionId]);
          return { status: 'expired' };
        }

        const normalizedAnswer = typeof answer === 'string' ? answer.trim().toUpperCase() : '';
        const validFormat = new RegExp(`^[${CAPTCHA_ALPHABET}]{6}$`).test(normalizedAnswer);
        const suppliedHash = hashAnswer(sessionId, id, normalizedAnswer);
        const matches = validFormat && crypto.timingSafeEqual(suppliedHash, Buffer.from(challenge.answer_hash, 'hex'));
        if (!matches) {
          const attempts = challenge.attempts + 1;
          if (attempts >= CAPTCHA_MAX_ATTEMPTS) {
            await run('DELETE FROM registration_captchas WHERE session_id = ?', [sessionId]);
            return { status: 'attempts_exceeded' };
          }
          await run('UPDATE registration_captchas SET attempts = ? WHERE session_id = ?', [attempts, sessionId]);
          return { status: 'incorrect', attemptsRemaining: CAPTCHA_MAX_ATTEMPTS - attempts };
        }

        await run('DELETE FROM registration_captchas WHERE session_id = ?', [sessionId]);
        return { status: 'valid' };
      });
    }
  };
}
module.exports = { initializeRegistrationCaptcha, createRegistrationCaptcha };

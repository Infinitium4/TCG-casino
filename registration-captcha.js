const crypto = require('node:crypto');

async function initializeRegistrationCaptcha(run) {
  await run(`CREATE TABLE IF NOT EXISTS registration_captchas (
    session_id TEXT PRIMARY KEY, id TEXT NOT NULL, answer INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`);
}

function createRegistrationCaptcha({ run, get, withDatabaseTransaction, now = Date.now }) {
  return {
    async issue(sessionId) {
      const left = crypto.randomInt(1, 20), right = crypto.randomInt(1, 20);
      const id = crypto.randomBytes(24).toString('hex');
      await withDatabaseTransaction(async () => {
        await run('DELETE FROM registration_captchas WHERE expires_at <= ?', [now()]);
        await run('INSERT OR REPLACE INTO registration_captchas (session_id, id, answer, expires_at) VALUES (?, ?, ?, ?)',
          [sessionId, id, left + right, now() + 5 * 60 * 1000]);
      });
      return { id, question: `${left} + ${right} = ?` };
    },
    async consume(sessionId, id, answer) {
      return withDatabaseTransaction(async () => {
        const challenge = await get('SELECT * FROM registration_captchas WHERE session_id = ?', [sessionId]);
        // Consume even incorrect attempts; a concurrent replay cannot reuse the challenge.
        await run('DELETE FROM registration_captchas WHERE session_id = ?', [sessionId]);
        return Boolean(challenge && challenge.id === id && challenge.expires_at > now()
          && typeof answer === 'string' && /^\d{1,2}$/.test(answer.trim())
          && Number(answer) === challenge.answer);
      });
    }
  };
}
module.exports = { initializeRegistrationCaptcha, createRegistrationCaptcha };

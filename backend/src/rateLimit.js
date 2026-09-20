// Rate limiting simples em memória para tentativas de login.
// Suficiente para uma instância única do MVP. Se o backend rodar
// com múltiplas instâncias no futuro, trocar por Redis.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 minutos de bloqueio

const attempts = new Map(); // key -> { count, windowStart, lockedUntil }

function keyFor(frameToken, ip) {
  return `${frameToken}::${ip}`;
}

function isLocked(frameToken, ip) {
  const entry = attempts.get(keyFor(frameToken, ip));
  if (!entry) return false;
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true;
  return false;
}

function registerFailure(frameToken, ip) {
  const key = keyFor(frameToken, ip);
  const now = Date.now();
  let entry = attempts.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: null };
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_MS;
  }

  attempts.set(key, entry);
}

function registerSuccess(frameToken, ip) {
  attempts.delete(keyFor(frameToken, ip));
}

module.exports = { isLocked, registerFailure, registerSuccess };

const usageByUid = new Map();

function positiveIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function maxSessionSeconds() {
  return positiveIntEnv("VOICE_LIVE_MAX_SESSION_SECONDS", 180);
}

function dailyCapForPlan(plan) {
  if (plan === "free") return positiveIntEnv("VOICE_LIVE_DAILY_SECONDS_FREE", 0);
  return positiveIntEnv("VOICE_LIVE_DAILY_SECONDS_PRO", 300);
}

function currentUsage(uid, day = todayKey()) {
  const existing = usageByUid.get(uid);
  if (!existing || existing.day !== day) {
    const fresh = { day, secondsByMode: new Map() };
    usageByUid.set(uid, fresh);
    return fresh;
  }
  return existing;
}

function totalSeconds(usage) {
  let total = 0;
  for (const seconds of usage.secondsByMode.values()) total += seconds;
  return total;
}

function canStart(uid, mode, plan) {
  const cap = dailyCapForPlan(plan);
  const usage = currentUsage(uid);
  const used = totalSeconds(usage);
  const remainingSecondsToday = Math.max(0, cap - used);
  if (!uid || remainingSecondsToday <= 0) {
    return {
      ok: false,
      error: "voice_quota_exceeded",
      maxSessionSeconds: maxSessionSeconds(),
      remainingSecondsToday,
    };
  }
  return {
    ok: true,
    maxSessionSeconds: Math.min(maxSessionSeconds(), remainingSecondsToday),
    remainingSecondsToday,
  };
}

function recordSeconds(uid, mode, seconds) {
  const charged = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!uid || !mode || charged <= 0) return;
  const usage = currentUsage(uid);
  usage.secondsByMode.set(mode, (usage.secondsByMode.get(mode) || 0) + charged);
}

function __resetForTest() {
  usageByUid.clear();
}

module.exports = {
  canStart,
  recordSeconds,
  maxSessionSeconds,
  __resetForTest,
};

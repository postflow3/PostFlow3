import { userKey, encryptJson, decryptJson } from "./security.js";

const validPlatform = value => value === "instagram" || value === "youtube";
const safeId = value => String(value || "").trim().slice(0, 180);

export function socialAccountKey(userId, platform, accountId) {
  if (!validPlatform(platform) || !safeId(accountId)) throw new Error("Conta social inválida.");
  return userKey(userId, "social-account:" + platform + ":" + encodeURIComponent(safeId(accountId)));
}

export async function listSocialAccounts(env, userId) {
  const raw = await env.POSTFLOW3_KV.get(userKey(userId, "social-accounts"));
  const accounts = raw ? JSON.parse(raw) : [];
  return Array.isArray(accounts) ? accounts.filter(a => a && validPlatform(a.platform) && safeId(a.accountId)) : [];
}

export async function saveSocialAccount(env, userId, platform, accountId, username, tokenData) {
  if (!validPlatform(platform) || !safeId(accountId)) throw new Error("Não foi possível identificar a conta social.");
  const key = socialAccountKey(userId, platform, accountId);
  await env.POSTFLOW3_KV.put(key, await encryptJson(env, tokenData));
  const accounts = await listSocialAccounts(env, userId);
  const now = new Date().toISOString();
  const existing = accounts.find(a => a.platform === platform && String(a.accountId) === String(accountId));
  const next = {
    accountId: safeId(accountId),
    platform,
    username: String(username || "").trim().slice(0, 160),
    connectedAt: existing?.connectedAt || now,
    updatedAt: now
  };
  const filtered = accounts.filter(a => !(a.platform === platform && String(a.accountId) === String(accountId)));
  filtered.push(next);
  await env.POSTFLOW3_KV.put(userKey(userId, "social-accounts"), JSON.stringify(filtered));
  // Keep the previous primary-account key so existing publishing flows continue to work.
  await env.POSTFLOW3_KV.put(userKey(userId, platform + "-owner"), await encryptJson(env, tokenData));
  return next;
}

export async function getSocialAccount(env, userId, platform, accountId = "") {
  if (!validPlatform(platform)) return null;
  const id = safeId(accountId);
  if (id && id !== "primary") {
    const raw = await env.POSTFLOW3_KV.get(socialAccountKey(userId, platform, id));
    if (raw) return await decryptJson(env, raw);
    return null;
  }
  if (id === "primary") {
    const legacy = await env.POSTFLOW3_KV.get(userKey(userId, platform + "-owner"));
    return legacy ? await decryptJson(env, legacy) : null;
  }
  const raw = await env.POSTFLOW3_KV.get(userKey(userId, platform + "-owner"));
  return raw ? await decryptJson(env, raw) : null;
}

export async function removeSocialAccount(env, userId, platform, accountId) {
  const id = safeId(accountId);
  if (!validPlatform(platform) || !id) throw new Error("Conta social inválida.");
  await env.POSTFLOW3_KV.delete(socialAccountKey(userId, platform, id));
  const accounts = await listSocialAccounts(env, userId);
  const remaining = accounts.filter(a => !(a.platform === platform && String(a.accountId) === id));
  await env.POSTFLOW3_KV.put(userKey(userId, "social-accounts"), JSON.stringify(remaining));
  // If the removed account was the legacy primary, point the compatibility key at another saved account.
  const legacyKey = userKey(userId, platform + "-owner");
  const current = await env.POSTFLOW3_KV.get(legacyKey);
  if (current) {
    try {
      const data = await decryptJson(env, current);
      const currentId = platform === "instagram" ? String(data.user_id || "") : String(data.channel_id || "");
      if (currentId === id) {
        const replacement = remaining.find(a => a.platform === platform);
        const replacementRaw = replacement ? await env.POSTFLOW3_KV.get(socialAccountKey(userId, platform, replacement.accountId)) : null;
        if (replacementRaw) await env.POSTFLOW3_KV.put(legacyKey, replacementRaw);
        else await env.POSTFLOW3_KV.delete(legacyKey);
      }
    } catch {}
  }
}

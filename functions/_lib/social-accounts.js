import { userKey, encryptJson, decryptJson } from "./security.js";

const validPlatform = value => value === "instagram" || value === "youtube" || value === "tiktok";
const d1Platform = value => value === "instagram" || value === "youtube" || value === "tiktok";
const safeId = value => String(value || "").trim().slice(0, 180);
const accountRow = row => ({
  accountId: String(row.platform_user_id || ""),
  platform: row.platform,
  username: String(row.username || ""),
  connectedAt: row.connected_at,
  updatedAt: row.updated_at
});

export function socialAccountKey(userId, platform, accountId) {
  if (!validPlatform(platform) || !safeId(accountId)) throw new Error("Conta social inválida.");
  return userKey(userId, "social-account:" + platform + ":" + encodeURIComponent(safeId(accountId)));
}

// Instagram and YouTube credentials use the existing encrypted D1 table. KV remains
// a read-only compatibility source for old connections and the existing publishing queue.
export async function listSocialAccounts(env, userId) {
  const byKey = new Map();
  if (env.POSTFLOW3_DB) {
    const result = await env.POSTFLOW3_DB.prepare(
      "SELECT platform, platform_user_id, username, connected_at, updated_at FROM social_accounts WHERE user_id = ? ORDER BY updated_at DESC"
    ).bind(userId).all();
    for (const row of result.results || []) {
      if (row?.platform_user_id && validPlatform(row.platform)) {
        const item = accountRow(row);
        byKey.set(item.platform + ":" + item.accountId, item);
      }
    }
  }
  // Read legacy metadata once; do not write it back on successful D1 operations.
  if (env.POSTFLOW3_KV) {
    try {
      const raw = await env.POSTFLOW3_KV.get(userKey(userId, "social-accounts"));
      const legacy = raw ? JSON.parse(raw) : [];
      if (Array.isArray(legacy)) for (const item of legacy) {
        if (item && validPlatform(item.platform) && safeId(item.accountId)) {
          const key = item.platform + ":" + safeId(item.accountId);
          if (!byKey.has(key)) byKey.set(key, item);
        }
      }
    } catch {}
  }
  return [...byKey.values()];
}

export async function saveSocialAccount(env, userId, platform, accountId, username, tokenData) {
  const id = safeId(accountId);
  if (!validPlatform(platform) || !id) throw new Error("Não foi possível identificar a conta social.");
  const encrypted = await encryptJson(env, tokenData);
  const now = new Date().toISOString();

  if (d1Platform(platform) && env.POSTFLOW3_DB) {
    const expires = Number(tokenData?.expiry_date || tokenData?.access_token_expires_at || 0);
    await env.POSTFLOW3_DB.prepare(
      "INSERT INTO social_accounts (id, user_id, platform, platform_user_id, username, encrypted_tokens, token_expires_at, connected_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, platform, platform_user_id) DO UPDATE SET username = excluded.username, encrypted_tokens = excluded.encrypted_tokens, token_expires_at = excluded.token_expires_at, updated_at = excluded.updated_at"
    ).bind(
      crypto.randomUUID(), userId, platform, id, String(username || "").trim().slice(0, 160),
      encrypted, expires ? new Date(expires).toISOString() : null, now, now
    ).run();
    return { accountId: id, platform, username: String(username || "").trim().slice(0, 160), connectedAt: now, updatedAt: now };
  }

  // TikTok and legacy installations without D1 retain the existing KV format.
  if (!env.POSTFLOW3_KV) throw new Error("Armazenamento seguro indisponível. Configure POSTFLOW3_DB.");
  const key = socialAccountKey(userId, platform, id);
  await env.POSTFLOW3_KV.put(key, encrypted);
  const accounts = await listSocialAccounts(env, userId);
  const existing = accounts.find(a => a.platform === platform && String(a.accountId) === id);
  const next = { accountId: id, platform, username: String(username || "").trim().slice(0, 160), connectedAt: existing?.connectedAt || now, updatedAt: now };
  const filtered = accounts.filter(a => !(a.platform === platform && String(a.accountId) === id));
  filtered.push(next);
  await env.POSTFLOW3_KV.put(userKey(userId, "social-accounts"), JSON.stringify(filtered));
  await env.POSTFLOW3_KV.put(userKey(userId, platform + "-owner"), encrypted);
  return next;
}

export async function updateSocialAccountTokens(env, userId, platform, accountId, tokenData) {
  if (!validPlatform(platform)) throw new Error("Conta social inválida.");
  const encrypted = await encryptJson(env, tokenData);
  const now = new Date().toISOString();
  const id = safeId(accountId);

  if (env.POSTFLOW3_DB) {
    let targetId = id && id !== "primary" ? id : "";
    if (!targetId) {
      const row = await env.POSTFLOW3_DB.prepare(
        "SELECT platform_user_id FROM social_accounts WHERE user_id = ? AND platform = ? ORDER BY updated_at DESC LIMIT 1"
      ).bind(userId, platform).first();
      targetId = String(row?.platform_user_id || "");
    }
    if (targetId) {
      const expires = Number(tokenData?.expiry_date || tokenData?.access_token_expires_at || 0);
      const result = await env.POSTFLOW3_DB.prepare(
        "UPDATE social_accounts SET encrypted_tokens = ?, token_expires_at = ?, updated_at = ? WHERE user_id = ? AND platform = ? AND platform_user_id = ?"
      ).bind(encrypted, expires ? new Date(expires).toISOString() : null, now, userId, platform, targetId).run();
      if (Number(result.meta?.changes || 0) > 0) return;
    }
  }

  if (!env.POSTFLOW3_KV) throw new Error("Não foi possível salvar a renovação da conta social.");
  const key = id && id !== "primary" ? socialAccountKey(userId, platform, id) : userKey(userId, platform + "-owner");
  await env.POSTFLOW3_KV.put(key, encrypted);
}

export async function getSocialAccount(env, userId, platform, accountId = "") {
  if (!validPlatform(platform)) return null;
  const id = safeId(accountId);
  if (d1Platform(platform) && env.POSTFLOW3_DB) {
    let row = null;
    if (id && id !== "primary") {
      row = await env.POSTFLOW3_DB.prepare(
        "SELECT encrypted_tokens FROM social_accounts WHERE user_id = ? AND platform = ? AND platform_user_id = ? LIMIT 1"
      ).bind(userId, platform, id).first();
    } else {
      row = await env.POSTFLOW3_DB.prepare(
        "SELECT encrypted_tokens FROM social_accounts WHERE user_id = ? AND platform = ? ORDER BY updated_at DESC LIMIT 1"
      ).bind(userId, platform).first();
    }
    if (row?.encrypted_tokens) return decryptJson(env, row.encrypted_tokens);
  }

  if (!env.POSTFLOW3_KV) return null;
  if (id && id !== "primary") {
    const raw = await env.POSTFLOW3_KV.get(socialAccountKey(userId, platform, id));
    if (raw) return decryptJson(env, raw);
    const legacy = await env.POSTFLOW3_KV.get(userKey(userId, platform + "-owner"));
    if (legacy) {
      const data = await decryptJson(env, legacy);
      const legacyId = platform === "instagram" ? String(data.user_id || "") : platform === "tiktok" ? String(data.open_id || "") : String(data.channel_id || "");
      if (legacyId && legacyId === id) return data;
    }
    return null;
  }
  const legacy = await env.POSTFLOW3_KV.get(userKey(userId, platform + "-owner"));
  return legacy ? decryptJson(env, legacy) : null;
}

export async function removeSocialAccount(env, userId, platform, accountId) {
  const id = safeId(accountId);
  if (!validPlatform(platform) || !id) throw new Error("Conta social inválida.");
  if (d1Platform(platform) && env.POSTFLOW3_DB) {
    await env.POSTFLOW3_DB.prepare(
      "DELETE FROM social_accounts WHERE user_id = ? AND platform = ? AND platform_user_id = ?"
    ).bind(userId, platform, id).run();
  }
  // Best-effort cleanup of legacy KV copies. A quota error must not undo the D1 deletion.
  if (env.POSTFLOW3_KV) {
    try {
      await env.POSTFLOW3_KV.delete(socialAccountKey(userId, platform, id));
      const accounts = await listSocialAccounts(env, userId);
      const remaining = accounts.filter(a => !(a.platform === platform && String(a.accountId) === id));
      await env.POSTFLOW3_KV.put(userKey(userId, "social-accounts"), JSON.stringify(remaining));
      const legacyKey = userKey(userId, platform + "-owner");
      const current = await env.POSTFLOW3_KV.get(legacyKey);
      if (current) {
        const data = await decryptJson(env, current);
        const currentId = platform === "instagram" ? String(data.user_id || "") : platform === "tiktok" ? String(data.open_id || "") : String(data.channel_id || "primary");
        if (currentId === id) await env.POSTFLOW3_KV.delete(legacyKey);
      }
    } catch {}
  }
}

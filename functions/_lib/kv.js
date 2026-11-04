// D1-backed compatibility store for the former Cloudflare KV queue.
// Reads legacy KV entries during migration, but all new writes go to D1.
function decodeCursor(value) {
  try { return Math.max(0, Number(atob(String(value || ""))) || 0); } catch { return 0; }
}
function encodeCursor(value) { return btoa(String(value)); }
export function kv(env) {
  const db = env.POSTFLOW3_DB;
  const legacy = env.POSTFLOW3_KV;
  if (!db && !legacy) return null;
  return {
    async get(key, type) {
      let value = null;
      if (db) {
        const row = await db.prepare("SELECT value FROM kv_store WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)").bind(String(key), Date.now()).first();
        if (row) value = row.value;
      }
      if (value === null && legacy) {
        value = await legacy.get(String(key));
        if (value !== null && db) {
          await db.prepare("INSERT OR REPLACE INTO kv_store (key, value, expires_at, updated_at) VALUES (?, ?, NULL, ?)").bind(String(key), String(value), Date.now()).run();
        }
      }
      if (value === null || value === undefined) return null;
      if (type === "json") {
        if (typeof value === "object") return value;
        try { return JSON.parse(value); } catch { return null; }
      }
      return value;
    },
    async put(key, value, options = {}) {
      if (db) {
        const ttl = Number(options.expirationTtl || 0);
        const expires = ttl > 0 ? Date.now() + ttl * 1000 : null;
        await db.prepare("INSERT OR REPLACE INTO kv_store (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)").bind(String(key), String(value), expires, Date.now()).run();
        return;
      }
      return legacy.put(String(key), value, options);
    },
    async delete(key) {
      if (db) await db.prepare("DELETE FROM kv_store WHERE key = ?").bind(String(key)).run();
      if (legacy) { try { await legacy.delete(String(key)); } catch {} }
    },
    async list(options = {}) {
      const prefix = String(options.prefix || ""), limit = Math.min(1000, Math.max(1, Number(options.limit || 1000)));
      const offset = decodeCursor(options.cursor);
      const names = new Set();
      if (db) {
        const rows = await db.prepare("SELECT key FROM kv_store WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key").bind(prefix.replace(/[\\%_]/g, "\\$&") + "%", Date.now()).all();
        for (const row of rows.results || []) names.add(row.key);
      }
      if (legacy) {
        let cursor;
        do {
          const page = await legacy.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
          for (const item of page.keys || []) names.add(item.name);
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
      }
      const all = [...names].filter(name => name.startsWith(prefix)).sort();
      const keys = all.slice(offset, offset + limit).map(name => ({ name }));
      const next = offset + keys.length;
      return { keys, list_complete: next >= all.length, ...(next < all.length ? { cursor: encodeCursor(next) } : {}) };
    }
  };
}

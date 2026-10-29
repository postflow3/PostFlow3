-- PostFlow3 multi-tenant foundation: initial capacity of 10 customer accounts.
-- Apply to a NEW Cloudflare D1 database. This migration does not alter existing KV data.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'monthly', 'quarterly', 'annual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Enforce the starter capacity in the database itself, including concurrent signups.
CREATE TRIGGER IF NOT EXISTS users_initial_capacity
BEFORE INSERT ON users
WHEN NEW.role = 'customer'
 AND (SELECT COUNT(*) FROM users WHERE role = 'customer' AND lower(email) <> 'sergiouai3@gmail.com') >= 10
BEGIN
  SELECT RAISE(ABORT, 'USER_CAPACITY_REACHED');
END;

CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram')),
  platform_user_id TEXT,
  username TEXT,
  encrypted_tokens TEXT NOT NULL,
  token_expires_at TEXT,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, platform, platform_user_id)
);
CREATE INDEX IF NOT EXISTS social_accounts_user_idx ON social_accounts(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  filename TEXT,
  media_key TEXT,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  platform_urls_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS posts_user_created_idx ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_schedule_idx ON posts(status, scheduled_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'monthly', 'quarterly', 'annual')),
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

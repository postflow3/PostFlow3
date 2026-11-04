-- Expand the encrypted social-account store to include TikTok.
-- Rebuild the CHECK constraint while preserving all existing rows and credentials.
PRAGMA foreign_keys = ON;

CREATE TABLE social_accounts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'tiktok')),
  platform_user_id TEXT,
  username TEXT,
  encrypted_tokens TEXT NOT NULL,
  token_expires_at TEXT,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, platform, platform_user_id)
);

INSERT INTO social_accounts_new (
  id, user_id, platform, platform_user_id, username, encrypted_tokens,
  token_expires_at, connected_at, updated_at
)
SELECT
  id, user_id, platform, platform_user_id, username, encrypted_tokens,
  token_expires_at, connected_at, updated_at
FROM social_accounts;

DROP TABLE social_accounts;
ALTER TABLE social_accounts_new RENAME TO social_accounts;
CREATE INDEX IF NOT EXISTS social_accounts_user_idx ON social_accounts(user_id);

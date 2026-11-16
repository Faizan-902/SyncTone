-- ==============================================================================
-- SyncTone Migration: Multi-Method Authentication (Passkeys + Google/GitHub OAuth)
-- ==============================================================================

-- 1. Allow OAuth-only / Passkey-only users without a local password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Linked OAuth Accounts (Google, GitHub, etc.)
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_oauth_provider_account UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS ix_oauth_accounts_user_id ON oauth_accounts(user_id);

-- 3. WebAuthn Passkeys (Biometric / Hardware Security Keys)
CREATE TABLE IF NOT EXISTS user_passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type VARCHAR(32) NOT NULL DEFAULT 'singleDevice',
    backed_up BOOLEAN NOT NULL DEFAULT false,
    transports TEXT[] DEFAULT '{}',
    friendly_name VARCHAR(100) NOT NULL DEFAULT 'Passkey',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_user_passkeys_user_id ON user_passkeys(user_id);

-- 4. Ephemeral WebAuthn & OAuth State Challenges
CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge_id VARCHAR(128) PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    flow_type VARCHAR(32) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_auth_challenges_expires_at ON auth_challenges(expires_at);

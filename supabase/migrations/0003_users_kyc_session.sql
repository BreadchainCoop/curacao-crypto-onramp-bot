-- Curaçao Crypto On-Ramp — link users to their Synaps KYC session (Issue #8)
--
-- The Synaps webhook reports results by session_id (and carries no PII), so we
-- store the session id on the user to match the webhook back to the right row.

alter table users add column if not exists kyc_session_id text;

create unique index if not exists users_kyc_session_id_key
  on users (kyc_session_id);

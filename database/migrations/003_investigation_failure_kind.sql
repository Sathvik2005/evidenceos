-- Why a run ended in ERROR, as a coarse classified kind (never provider text, never secrets). NULL for every other
-- status: any later status change clears it, so a retry does not keep showing an old failure.
ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS failure_kind text
  CHECK (failure_kind IS NULL OR failure_kind IN (
    'VALIDATION', 'PROVIDER', 'TIMEOUT', 'RATE_LIMIT', 'MALFORMED_OUTPUT',
    'PERSISTENCE', 'AUTHENTICATION', 'AUTHORIZATION', 'NETWORK', 'WORKFLOW'
  ));

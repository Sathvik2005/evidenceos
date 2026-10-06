-- Adds the investigation lifecycle values used by the workflow and UI (Prompt 11/14).
-- Provisional, like 001. Old values stay: enum values cannot be removed.
ALTER TYPE investigation_status ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE investigation_status ADD VALUE IF NOT EXISTS 'RESEARCHING';
ALTER TYPE investigation_status ADD VALUE IF NOT EXISTS 'ANALYZING';
ALTER TYPE investigation_status ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE investigation_status ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';
ALTER TYPE investigation_status ADD VALUE IF NOT EXISTS 'ERROR';

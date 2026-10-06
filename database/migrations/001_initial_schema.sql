BEGIN;

CREATE TYPE investigation_status AS ENUM (
  'DRAFT',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE claim_state AS ENUM (
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'CONFLICTING',
  'INSUFFICIENT'
);

CREATE TYPE confidence_level AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TYPE evidence_relationship AS ENUM (
  'SUPPORTS',
  'CONTRADICTS',
  'PARTIALLY_SUPPORTS',
  'INSUFFICIENT'
);

CREATE TYPE evidence_strength AS ENUM ('STRONG', 'MODERATE', 'WEAK', 'UNKNOWN');

CREATE TYPE source_type AS ENUM (
  'WEB_PAGE',
  'JOURNAL_ARTICLE',
  'BOOK',
  'REPORT',
  'DATASET',
  'OTHER'
);

CREATE TABLE investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL CHECK (length(btrim(owner_id)) > 0),
  question text NOT NULL CHECK (length(btrim(question)) > 0),
  status investigation_status NOT NULL DEFAULT 'DRAFT',
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investigations_idempotency_key_unique
    UNIQUE (owner_id, idempotency_key),
  CONSTRAINT investigations_id_idempotency_key
    UNIQUE (id, idempotency_key)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  statement text NOT NULL CHECK (length(btrim(statement)) > 0),
  state claim_state,
  confidence confidence_level,
  assessment_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claims_investigation_fk
    FOREIGN KEY (investigation_id)
    REFERENCES investigations (id)
    ON DELETE RESTRICT,
  CONSTRAINT claims_investigation_ordinal_unique
    UNIQUE (investigation_id, ordinal),
  CONSTRAINT claims_investigation_id_unique
    UNIQUE (investigation_id, id),
  CONSTRAINT claims_idempotency_key_unique
    UNIQUE (investigation_id, idempotency_key)
);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL,
  source_type source_type NOT NULL,
  url text NOT NULL CHECK (url ~* '^https?://'),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sources_investigation_fk
    FOREIGN KEY (investigation_id)
    REFERENCES investigations (id)
    ON DELETE RESTRICT,
  CONSTRAINT sources_investigation_id_unique
    UNIQUE (investigation_id, id),
  CONSTRAINT sources_investigation_url_unique
    UNIQUE (investigation_id, url),
  CONSTRAINT sources_idempotency_key_unique
    UNIQUE (investigation_id, idempotency_key)
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  source_id uuid NOT NULL,
  relationship evidence_relationship NOT NULL,
  strength evidence_strength NOT NULL,
  excerpt text NOT NULL CHECK (length(btrim(excerpt)) > 0),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_claim_investigation_fk
    FOREIGN KEY (investigation_id, claim_id)
    REFERENCES claims (investigation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_source_investigation_fk
    FOREIGN KEY (investigation_id, source_id)
    REFERENCES sources (investigation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_investigation_id_unique
    UNIQUE (investigation_id, id),
  CONSTRAINT evidence_claim_id_unique
    UNIQUE (investigation_id, claim_id, id),
  CONSTRAINT evidence_idempotency_key_unique
    UNIQUE (investigation_id, idempotency_key)
);

CREATE TABLE evidence_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  previous_state claim_state,
  new_state claim_state NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  triggering_evidence_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_changes_distinct_state
    CHECK (previous_state IS DISTINCT FROM new_state),
  CONSTRAINT evidence_changes_claim_fk
    FOREIGN KEY (investigation_id, claim_id)
    REFERENCES claims (investigation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_changes_trigger_evidence_fk
    FOREIGN KEY (investigation_id, claim_id, triggering_evidence_id)
    REFERENCES evidence (investigation_id, claim_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_changes_idempotency_key_unique
    UNIQUE (investigation_id, idempotency_key)
);

CREATE INDEX investigations_owner_created_idx
  ON investigations (owner_id, created_at DESC);

CREATE INDEX investigations_status_created_idx
  ON investigations (status, created_at DESC);

CREATE INDEX claims_investigation_state_idx
  ON claims (investigation_id, state);

CREATE INDEX sources_investigation_type_idx
  ON sources (investigation_id, source_type);

CREATE INDEX evidence_claim_created_idx
  ON evidence (investigation_id, claim_id, created_at DESC);

CREATE INDEX evidence_source_idx
  ON evidence (investigation_id, source_id);

CREATE INDEX evidence_changes_claim_changed_idx
  ON evidence_changes (investigation_id, claim_id, changed_at DESC);

CREATE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER investigations_update_updated_at
  BEFORE UPDATE ON investigations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER claims_update_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sources_update_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE FUNCTION apply_claim_state_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE claims
  SET state = NEW.new_state
  WHERE investigation_id = NEW.investigation_id
    AND id = NEW.claim_id
    AND state IS NOT DISTINCT FROM NEW.previous_state;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim state does not match the recorded previous state.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_changes_apply_claim_state
  BEFORE INSERT ON evidence_changes
  FOR EACH ROW EXECUTE FUNCTION apply_claim_state_change();

CREATE FUNCTION reject_evidence_change_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Evidence change history is append-only.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER evidence_changes_append_only
  BEFORE UPDATE OR DELETE ON evidence_changes
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_change_mutation();

COMMIT;

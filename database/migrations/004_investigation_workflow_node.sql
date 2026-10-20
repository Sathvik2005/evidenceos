-- The workflow step an investigation is currently in (or stopped at), written by the workflow as each node starts.
-- It is a progress display only: nothing reads it to decide behavior. NULL until the first step runs.
ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS workflow_node text
  CHECK (workflow_node IS NULL OR workflow_node IN (
    'load', 'decompose', 'validateClaims', 'persistClaims', 'research', 'validateEvidence', 'analyze',
    'validateAssessment', 'evaluate', 'decide', 'persistState', 'detectChange', 'summarize'
  ));

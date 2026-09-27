-- Lineage keeps when capture fingerprinted the inputs, beside when the baseline was written. Null for
-- lineage written before this column, or when the agent did not pass captured_at.
ALTER TABLE lineage
  ADD COLUMN captured_at timestamptz;

-- Add authenticated product-feedback records to the canonical state document.
-- This deliberately remains schema-version 2: adding an empty collection is
-- backward-compatible with the current reader, which keeps rolling deployment
-- and rollback safe while older serverless instances may still be alive.

update public.operating_state
set state = jsonb_set(state, '{supportRequests}', '[]'::jsonb, true)
where not (state ? 'supportRequests');

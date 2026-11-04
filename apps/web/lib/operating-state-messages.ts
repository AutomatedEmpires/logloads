/**
 * What a client is told when the snapshot writer refuses a write because the
 * shared document would pass its size limit (HF-02, #187). Fixed text: the
 * sizes are for the operator's log, not the client.
 */
export const OPERATING_STATE_FULL_MESSAGE =
  "This change was not saved because the shared record store is at its size limit. Contact LogLoads support."

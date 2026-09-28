/**
 * The Claude account and device that Claude Code reports in a Messages
 * request. Claude Code sends `metadata.user_id` as a JSON string such as
 * `{"device_id":"…","account_uuid":"…","session_id":"…"}`. The client sets
 * these values, so the gateway can't verify them.
 */
export interface ClaudeUser {
  accountUuid: string | null;
  deviceId: string | null;
}

export function parseClaudeUser(body: unknown): ClaudeUser {
  const userId = (body as { metadata?: { user_id?: unknown } } | null)?.metadata?.user_id;
  let parsed: { account_uuid?: unknown; device_id?: unknown } = {};
  if (typeof userId === "string") {
    try {
      parsed = JSON.parse(userId) ?? {};
    } catch {
      // Older clients send a non-JSON string; leave the IDs unset.
    }
  }
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return { accountUuid: str(parsed.account_uuid), deviceId: str(parsed.device_id) };
}

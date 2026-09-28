import type { ZuploContext, ZuploRequest } from "@zuplo/runtime";
import { parseClaudeUser } from "./claude-user";

/**
 * Copies the Claude account UUID from a Claude Code request onto
 * `context.custom.claudeAccountUuid`, so a metering budget rule with the
 * expression `context.custom.claudeAccountUuid` gives each Claude account its
 * own budget behind a shared app key.
 *
 * The UUID comes from the client and isn't verified: a user who edits it can
 * get a fresh budget. Requests without it skip the rule.
 */
export default async function claudeUserContext(
  request: ZuploRequest,
  context: ZuploContext,
  options: unknown,
  policyName: string,
) {
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/v1/messages")) {
    return request;
  }

  try {
    const { accountUuid } = parseClaudeUser(await request.clone().json());
    if (accountUuid) {
      context.custom.claudeAccountUuid = accountUuid;
    }
  } catch {
    context.log.warn(`${policyName}: request body is not JSON; skipping`);
  }

  return request;
}

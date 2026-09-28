import type { ZuploContext, ZuploRequest } from "@zuplo/runtime";
import { parseClaudeUser } from "./claude-user";

/**
 * Logs who sent each Claude Code request and, for turns where a person typed
 * a prompt, the prompt text. Add it to an app's policy chain after the auth
 * policy (so `request.user` is set) and after DLP (so it logs masked text).
 *
 * The caller's Claude login in `Authorization` is never read or logged.
 */
interface PromptAuditLogOptions {
  /** Log the prompt text. Set false to log only identity and request metadata. */
  logPromptText?: boolean;
  /** Truncate logged prompt text to this many characters. */
  maxPromptChars?: number;
  /** Drop the `<system-reminder>` blocks Claude Code adds to user turns. */
  excludeSystemReminders?: boolean;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface MessagesBody {
  model?: string;
  stream?: boolean;
  messages?: { role?: string; content?: string | ContentBlock[] }[];
}

const SYSTEM_REMINDER = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

export default async function promptAuditLog(
  request: ZuploRequest,
  context: ZuploContext,
  options: PromptAuditLogOptions = {},
  policyName: string,
) {
  const {
    logPromptText = true,
    maxPromptChars = 4000,
    excludeSystemReminders = true,
  } = options;

  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/v1/messages")) {
    return request;
  }

  let body: MessagesBody;
  try {
    body = await request.clone().json();
  } catch {
    context.log.warn(`${policyName}: request body is not JSON; skipping`);
    return request;
  }

  // The last user message is either a person's prompt (text blocks) or the
  // results of tool calls Claude Code ran (tool_result blocks).
  const last = body.messages?.findLast((m) => m.role === "user");
  const blocks: ContentBlock[] =
    typeof last?.content === "string"
      ? [{ type: "text", text: last.content }]
      : (last?.content ?? []);
  const texts = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .filter((t) => !(excludeSystemReminders && SYSTEM_REMINDER.test(t)));
  const turn = texts.length > 0 ? "prompt" : "tool_result";

  const claudeUser = parseClaudeUser(body);

  let prompt: string | undefined;
  if (logPromptText && turn === "prompt") {
    const joined = texts.join("\n\n");
    prompt = joined.length > maxPromptChars ? `${joined.slice(0, maxPromptChars)}…` : joined;
  }

  const headers = request.headers;
  context.log.info({
    event: "claude_code_request",
    requestId: context.requestId,
    // Verified: the Zuplo key that authenticated this request. With one app
    // per person, this is the person.
    gatewayUser: request.user?.sub ?? null,
    // The Claude account behind the forwarded login, as reported by the
    // client. Stable per person.
    claudeAccountUuid: claudeUser.accountUuid,
    claudeDeviceId: claudeUser.deviceId,
    sessionId: headers.get("x-claude-code-session-id"),
    agentId: headers.get("x-claude-code-agent-id"),
    promptId: headers.get("x-claude-code-prompt-id"),
    requestClass: headers.get("x-claude-code-request-class"),
    model: body.model ?? null,
    stream: body.stream === true,
    messageCount: body.messages?.length ?? 0,
    turn,
    prompt,
  });

  return request;
}

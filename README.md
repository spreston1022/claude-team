## Zuplo AI Gateway

This is a Zuplo AI Gateway that was created with
[`create-zuplo-api`](https://zuplo.com/docs). It gives your applications one
OpenAI-compatible API in front of many AI providers, with per-app keys, model
controls, budgets, caching, and guardrails.

## Getting Started

The gateway loads each app's configuration (providers, models, and policies)
from your Zuplo account at request time, so the project must be linked to a
Zuplo project before it can serve requests.

1. Link the project. This writes your project's settings to `.env.zuplo`, which
   is gitignored:

   ```bash
   npx zuplo link
   ```

2. In the [Zuplo Portal](https://portal.zuplo.com), add a provider and create an
   app. Each app gets its own API URL and API key. See
   [Apps](https://zuplo.com/docs/ai-gateway/apps).

3. Start the development server:

   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   ```

4. Send a request to the local gateway. Replace `<app_id>` with the ID from your
   app's API URL and set `ZUPLO_APP_API_KEY` to the app's API key:

   ```bash
   curl http://localhost:9000/<app_id>/v1/chat/completions \
     -H "Authorization: Bearer $ZUPLO_APP_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "openai/gpt-4o-mini",
       "messages": [{ "role": "user", "content": "Say hi" }]
     }'
   ```

## Claude Subscription Passthrough

Claude Code can route through this gateway while still using a `claude.ai`
subscription (Pro, Max, and so on) instead of an Anthropic API key. The gateway
forwards the caller's `Authorization` header (their Claude login) to Anthropic
and reads the Zuplo app key from a separate `zp-gateway-api-key` header, so the
app's policies and metering still run.

`config/policies.json` declares `ai-gateway-auth-v2-passthrough-inbound` for
this. Its options are:

```json
{
  "credentialPassthrough": true,
  "authHeader": "zp-gateway-api-key",
  "authScheme": ""
}
```

1. In the Zuplo Portal, add `ai-gateway-auth-v2-passthrough-inbound` to the
   Claude Code app's policy chain in place of `ai-gateway-auth-v2-inbound`.
2. The Anthropic provider still needs an API key saved. Passthrough requests
   don't use it, so a placeholder is fine unless a fallback model needs it.
3. In `~/.claude/settings.json`, point Claude Code at the app. Don't set
   `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`, because either one replaces
   the Claude login:

   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "https://<gateway-host>/<app_id>",
       "ANTHROPIC_CUSTOM_HEADERS": "zp-gateway-api-key: <app-api-key>",
       "ANTHROPIC_MODEL": "anthropic/claude-sonnet-5",
       "ANTHROPIC_SMALL_FAST_MODEL": "anthropic/claude-haiku-4-5",
       "ANTHROPIC_DEFAULT_OPUS_MODEL": "anthropic/claude-opus-5",
       "ANTHROPIC_DEFAULT_SONNET_MODEL": "anthropic/claude-sonnet-5",
       "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic/claude-haiku-4-5",
       "ANTHROPIC_DEFAULT_FABLE_MODEL": "anthropic/claude-fable-5-1"
     }
   }
   ```

4. Check it with `claude auth status --text` (it should report a `claude.ai`
   login) and `claude -p "Reply with OK"`.

To stop a runaway agent loop, `ai-gateway-metering-v2-inbound` gives every
Claude Code session its own hourly budget. Claude Code sends
`x-claude-code-session-id` on every request, and the policy warns at 300 and
blocks at 600 requests per session per hour. It counts requests, not cost,
because the gateway prices subscription traffic at API rates, which
overstates what a subscription costs. Requests without the header skip this
rule. A session isn't a person: restarting Claude Code starts a new session
with a fresh budget, so use one app per user for per-person limits. Add the
metering policy to the app's policy chain to turn this on.

The same metering policy also gives each Claude account its own budget,
even when everyone shares one app key. `claude-user-context-inbound` copies the
Claude account UUID from the request's `metadata.user_id` to
`context.custom.claudeAccountUuid`, and a budget rule keyed on that expression
warns at 1,000 and blocks at 2,000 requests per account per hour, and blocks at
15,000 per day. Add both `claude-user-context-inbound` and the metering policy
to the app's policy chain. The limits are placeholders; tune them to observed
usage. Caveats:

- Claude Code reports the UUID and the gateway can't verify it. A user who
  edits it gets a fresh budget, so treat this as a guardrail for well-meaning
  users, not enforcement. One app per person gives a limit users can't evade.
- Requests without the UUID skip this rule. `metadata.user_id` isn't in
  Anthropic's gateway documentation, so a future Claude Code release could
  change or drop it.

`prompt-audit-log-inbound` (`modules/prompt-audit-log.ts`) logs who sent each
Claude Code request and, when a person typed a prompt, its text. Place it after
the auth policy and after DLP, so it logs masked text. Each log entry records
three identities:

- `gatewayUser`: the Zuplo key that authenticated the request. It's verified,
  and it identifies a person when each person has their own app.
- `declaredUser`: the `x-user-id` header (set with `ANTHROPIC_CUSTOM_HEADERS`).
  It's unverified.
- `claudeAccountUuid`: the Claude account ID that Claude Code sends in the
  request's `metadata.user_id`. It identifies the person behind a shared app
  key, but the client reports it and the gateway can't verify it. Requests
  carry only the ID, so list ID-to-email pairs in the `accountDirectory`
  option to also log `claudeAccountEmail`. Each user's ID is `accountUuid`
  under `oauthAccount` in their `~/.claude.json`.

Tool-result turns are logged without their content. The `Authorization`
header, which carries the user's Claude login, is never read or logged. Set
`logPromptText` to `false` to log identity and metadata only.

Token metering prices usage at API rates, so for subscription traffic it will
overstate the real cost. See the
[Claude Code integration guide](https://zuplo.com/docs/ai-gateway/integrations/claude-code#use-your-claude-subscription).

## Endpoints

Every request is scoped to an app by the first path segment, `/{app_id}`. For
the supported endpoints and which providers serve each one, see the
[AI Gateway documentation](https://zuplo.com/docs/ai-gateway/overview).

## Project Structure

| Path                       | What it does                                                           |
| -------------------------- | ---------------------------------------------------------------------- |
| `config/ai.oas.json`       | The catch-all route that sends `/{app_id}/*` to the AI Gateway handler |
| `config/policies.json`     | The policies an app can select for its policy chain                    |
| `modules/zuplo.runtime.ts` | Runtime plugins, such as tracing and logging                           |
| `.env.example`             | Sample environment variables. Copy it to `.env` for local development  |

An app runs only the policies listed in its policy chain, and it can select only
policies declared in `config/policies.json`. To add your own policy, write it in
`modules/` and declare it in `config/policies.json`.

## Debugging

In VS Code, open **Run and Debug**, select **Launch & Attach Zuplo**, and click
the green play button.

For other editors and more details, see the
[debugging guide](https://zuplo.com/docs/articles/local-development-debugging).

## Deploying

Connect the project to source control in the Zuplo Portal. Pushes to your
default branch deploy the gateway to production.

## Learn More

To learn more about the AI Gateway, visit the
[AI Gateway documentation](https://zuplo.com/docs/ai-gateway/overview).

To connect with the community join [Discord](https://discord.zuplo.com).

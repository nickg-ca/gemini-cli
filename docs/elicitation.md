# MCP elicitation support

Gemini CLI supports
[MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation),
which lets MCP servers request additional information from users at runtime.
This enables richer interactive workflows such as account selection, OAuth
consent, or API key entry without requiring the server to fail the tool call.

> **Note:** This is a preview feature currently under active development.

## Modes

Elicitation operates in two modes:

- **Form mode** — The server sends a JSON Schema describing the data it needs.
  Gemini CLI renders a form in the terminal, collects the user's answers, and
  returns structured data.
- **URL mode** — The server provides a URL the user must visit (for example, an
  OAuth consent page). Gemini CLI displays the URL, asks for consent, and opens
  the system browser. The CLI never sees sensitive data exchanged at the URL.

## Architecture

The implementation spans three layers connected by the
[message bus](../packages/core/src/confirmation-bus/message-bus.ts):

```
MCP Server  ──elicitation/create──►  SDK Client (core)
                                      │
                        ┌─────────────┘
                        ▼
                   MessageBus  ──request──►  CLI (Ink UI)
                                              │
                        ┌─────────────────────┘
                        ▼
                   MessageBus  ◄──response──  CLI (Ink UI)
                        │
                        ▼
                   SDK Client  ──result──►  MCP Server
```

### Layer 1: SDK client (`packages/core`)

Capability registration and the request handler live in
[`mcp-client.ts`](../packages/core/src/tools/mcp-client.ts).

**Capability declaration** — In `connectToMcpServer()`, elicitation capabilities
are registered alongside the existing `roots` capability:

```typescript
mcpClient.registerCapabilities({
  roots: { listChanged: true },
  elicitation: {
    form: {},
    url: {},
  },
});
```

**Request handler** — In `McpClient.connect()`, a handler for
`elicitation/create` is registered using `RelaxedElicitRequestSchema`, a custom
Zod schema that accepts both `form` and `url` mode requests while being tolerant
of optional fields:

```typescript
this.client.setRequestHandler(RelaxedElicitRequestSchema, async (request) => {
  const messageBus = this.toolRegistry.getMessageBus();
  const response = await messageBus.request<
    McpElicitationRequest,
    McpElicitationResponse
  >(
    {
      type: MessageBusType.MCP_ELICITATION_REQUEST,
      serverName: this.serverName,
      ...request.params,
    },
    MessageBusType.MCP_ELICITATION_RESPONSE,
  );
  return { action: response.action, content: response.content };
});
```

The handler bridges the MCP SDK and the CLI: it receives the server's
elicitation request, forwards it through the message bus, waits for the user's
response, and returns the result to the SDK.

**Elicitation complete notifications** — If the server advertises elicitation
support in its capabilities, Gemini CLI subscribes to
`notifications/elicitation/complete` and publishes `MCP_ELICITATION_COMPLETE`
events on the message bus.

### Layer 2: Message bus (`packages/core`)

Three message types in
[`types.ts`](../packages/core/src/confirmation-bus/types.ts) support the
elicitation flow:

| Message type               | Purpose                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_ELICITATION_REQUEST`  | Sent from core to CLI when a server requests elicitation. Carries mode (`form` or `url`), server name, message, and either a JSON Schema or a URL. |
| `MCP_ELICITATION_RESPONSE` | Sent from CLI back to core with the user's answer. Contains an `action` (`accept`, `decline`, or `cancel`) and optional `content`.                 |
| `MCP_ELICITATION_COMPLETE` | Published when a `notifications/elicitation/complete` notification arrives from the server. Used for URL-mode completion tracking.                 |

Requests and responses are correlated by a `correlationId`, following the same
pattern used by tool confirmations and ask-user flows.

### Layer 3: CLI UI (`packages/cli`)

The CLI renders elicitation dialogs through three components:

**`useElicitation` hook**
([`useElicitation.ts`](../packages/cli/src/ui/hooks/useElicitation.ts)) —
Subscribes to `MCP_ELICITATION_REQUEST` on the message bus, queues pending
requests, and provides a `handleResponse` callback that publishes
`MCP_ELICITATION_RESPONSE` messages and removes the request from the queue.

**`ElicitationForm`**
([`ElicitationForm.tsx`](../packages/cli/src/ui/components/ElicitationForm.tsx))
— Renders form-mode requests. Converts the server's JSON Schema into questions
for the existing `AskUserDialog` component:

| Schema type                             | Rendering                 |
| --------------------------------------- | ------------------------- |
| `string` with `enum`                    | Single-select choice list |
| `boolean`                               | Yes/No selector           |
| `string`, `number`, `integer` (default) | Text input field          |

The component shows the requesting server's name and message, collects answers,
performs basic type coercion (booleans from "yes"/"no", numbers from strings),
and returns the structured `content` object.

**`ElicitationUrl`**
([`ElicitationUrl.tsx`](../packages/cli/src/ui/components/ElicitationUrl.tsx)) —
Renders URL-mode requests. Displays the server name, message, and the full URL.
Presents "Open URL and continue" and "Decline" options using a
`RadioButtonSelect`. On acceptance, opens the URL in the system browser using
the `open` package.

**`DialogManager`**
([`DialogManager.tsx`](../packages/cli/src/ui/components/DialogManager.tsx)) —
Renders elicitation dialogs based on the `mcpElicitationRequest` field in UI
state. Form-mode requests render `ElicitationForm`; URL-mode requests render
`ElicitationUrl`.

## URL elicitation error handling

When a tool call fails with error code `-32042` (`URLElicitationRequiredError`),
the [`McpCallableTool.callTool()`](../packages/core/src/tools/mcp-client.ts)
method handles it automatically:

1. Extract the `elicitations` array from the error's `data` field.
2. For each elicitation, publish an `MCP_ELICITATION_REQUEST` via the message
   bus and wait for the user's response.
3. If the user declines any elicitation, stop processing and return the error.
4. For URL-mode elicitations with an `elicitationId`, wait up to 10 minutes for
   a `notifications/elicitation/complete` notification. If the notification
   doesn't arrive, continue anyway.
5. After all elicitations are accepted and complete, retry the original tool
   call. The retry loop supports up to 10 attempts.

## Concurrency

Elicitation requests arrive while a `callTool()` call is pending. This doesn't
cause deadlock because:

- The MCP SDK processes incoming JSON-RPC messages on the transport layer
  independently from pending outgoing responses.
- The `setRequestHandler` callback runs in a separate async context from the
  `callTool()` promise.
- The `MessageBus.request()` method uses `EventEmitter`-based pub/sub with
  correlation IDs and doesn't block the event loop.

## Key files

| File                                                                           | Purpose                                                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`mcp-client.ts`](../packages/core/src/tools/mcp-client.ts)                    | Capability registration, request handler, `-32042` retry logic, `waitForElicitationComplete`                   |
| [`types.ts`](../packages/core/src/confirmation-bus/types.ts)                   | `MCP_ELICITATION_REQUEST`, `MCP_ELICITATION_RESPONSE`, `MCP_ELICITATION_COMPLETE` message types and interfaces |
| [`ElicitationForm.tsx`](../packages/cli/src/ui/components/ElicitationForm.tsx) | Ink component for form-mode rendering                                                                          |
| [`ElicitationUrl.tsx`](../packages/cli/src/ui/components/ElicitationUrl.tsx)   | Ink component for URL-mode rendering                                                                           |
| [`useElicitation.ts`](../packages/cli/src/ui/hooks/useElicitation.ts)          | React hook for subscribing to elicitation requests                                                             |
| [`DialogManager.tsx`](../packages/cli/src/ui/components/DialogManager.tsx)     | Routes elicitation requests to the correct dialog component                                                    |
| [`AppContainer.tsx`](../packages/cli/src/ui/AppContainer.tsx)                  | Wires `useElicitation` hook into the UI state and actions                                                      |

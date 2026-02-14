/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpClient } from './mcp-client.js';
import type { ToolRegistry } from './tool-registry.js';
import type { PromptRegistry } from '../prompts/prompt-registry.js';
import type { ResourceRegistry } from '../resources/resource-registry.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import type { Config } from '../config/config.js';
import {
  MessageBusType,
  type McpElicitationComplete,
} from '../confirmation-bus/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface MockMessageBus {
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('../confirmation-bus/message-bus.js');

describe('MCP Elicitation Retry', () => {
  let workspaceContext: WorkspaceContext;
  let testWorkspace: string;
  let messageBus: MockMessageBus;

  beforeEach(() => {
    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-elicitation-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);
    messageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      request: vi.fn(),
    };
  });

  it('should retry tool call after successful elicitation', async () => {
    const mockedClient = {
      connect: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'testTool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      callTool: vi
        .fn()
        .mockRejectedValueOnce({
          code: -32042,
          message: 'Elicitation required',
          data: {
            elicitations: [
              {
                mode: 'url',
                message: 'Authenticate first',
                url: 'https://auth.com',
                elicitationId: 'elic-1',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success after auth' }],
        }),
    };

    vi.mocked(Client).mockReturnValue(mockedClient as unknown as Client);

    messageBus.request.mockImplementation(async () => {
      // Simulate server sending notification after a short delay
      setTimeout(() => {
        // Find the listener and call it
        const found = messageBus.subscribe.mock.calls.find(
          (call) => call[0] === MessageBusType.MCP_ELICITATION_COMPLETE,
        );
        if (found) {
          const handler = found[1] as (msg: McpElicitationComplete) => void;
          handler({
            type: MessageBusType.MCP_ELICITATION_COMPLETE,
            serverName: 'test-server',
            elicitations: [{ elicitationId: 'elic-1', action: 'accept' }],
          });
        }
      }, 10);
      return { action: 'accept' };
    });

    const toolRegistry = {
      registerTool: vi.fn(),
      getMessageBus: vi.fn().mockReturnValue(messageBus),
      sortTools: vi.fn(),
    } as unknown as ToolRegistry;

    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: vi.fn(),
    } as unknown as PromptRegistry;

    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry;

    const mcpClient = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      workspaceContext,
      { sanitizationConfig: {} } as Config,
      false,
      '0.0.1',
    );

    await mcpClient.connect();
    await mcpClient.discover({
      getPolicyEngine: () => ({ addRule: vi.fn() }),
    } as unknown as Config);

    const registeredTool = vi.mocked(toolRegistry.registerTool).mock
      .calls[0][0];
    const invocation = registeredTool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(mockedClient.callTool).toHaveBeenCalledTimes(2);
    expect(messageBus.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageBusType.MCP_ELICITATION_REQUEST,
        mode: 'url',
        url: 'https://auth.com',
      }),
      MessageBusType.MCP_ELICITATION_RESPONSE,
    );
    expect(result.llmContent).toEqual([{ text: 'Success after auth' }]);
  });

  it('should not retry if elicitation is declined', async () => {
    const mockedClient = {
      connect: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'testTool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      callTool: vi.fn().mockRejectedValueOnce({
        code: -32042,
        message: 'Elicitation required',
        data: {
          elicitations: [
            {
              mode: 'url',
              message: 'Authenticate first',
              url: 'https://auth.com',
              elicitationId: 'elic-1',
            },
          ],
        },
      }),
    };

    vi.mocked(Client).mockReturnValue(mockedClient as unknown as Client);

    messageBus.request.mockResolvedValue({ action: 'decline' });

    const toolRegistry = {
      registerTool: vi.fn(),
      getMessageBus: vi.fn().mockReturnValue(messageBus),
      sortTools: vi.fn(),
    } as unknown as ToolRegistry;
    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: vi.fn(),
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry;

    const mcpClient = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      workspaceContext,
      { sanitizationConfig: {} } as Config,
      false,
      '0.0.1',
    );

    await mcpClient.connect();
    await mcpClient.discover({
      getPolicyEngine: () => ({ addRule: vi.fn() }),
    } as unknown as Config);

    const registeredTool = vi.mocked(toolRegistry.registerTool).mock
      .calls[0][0];
    const invocation = registeredTool.build({} as Record<string, unknown>);
    const result = await invocation.execute(new AbortController().signal);

    expect(mockedClient.callTool).toHaveBeenCalledTimes(1);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Elicitation required');
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'node:events';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * A wrapper transport that filters non-fatal deserialization errors from the
 * underlying StdioClientTransport.
 *
 * MCP SDK v1.26.0 (zod/v4) rejects JSON-RPC error responses with `"id": null`,
 * which is valid per the JSON-RPC 2.0 spec. The SDK's `RequestIdSchema.optional()`
 * accepts `string | number | undefined` but not `null`, causing a `ZodError` in
 * `deserializeMessage()`. This error propagates through the transport's `onerror`
 * and disconnects the client before discovery can occur.
 *
 * This wrapper intercepts errors from the inner transport and filters `ZodError`s
 * before they reach `Protocol.connect()`'s error handler chain. This prevents
 * non-fatal deserialization failures from disconnecting the client.
 */
export class ResilientStdioTransport extends EventEmitter implements Transport {
  constructor(private readonly transport: Transport) {
    super();

    // Forward messages and close events from the underlying transport
    this.transport.onmessage = (message) => {
      this.onmessage?.(message);
    };

    this.transport.onclose = () => {
      this.onclose?.();
    };

    // Filter ZodErrors from the underlying transport before they reach
    // Protocol.connect()'s error handler chain. ZodErrors from message
    // deserialization are non-fatal — the malformed message is simply
    // dropped and subsequent messages continue to be processed.
    this.transport.onerror = (error) => {
      if (error.name === 'ZodError') {
        debugLogger.log(
          `MCP transport: ignoring non-fatal deserialization error: ${error.message}`,
        );
        return;
      }
      this.onerror?.(error);
    };
  }

  // Transport interface implementation
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {
    await this.transport.start();
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await this.transport.send(message);
  }
}

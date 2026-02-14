/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ResilientStdioTransport } from './resilient-stdio-transport.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// Suppress debug log output during tests
vi.mock('../utils/debugLogger.js', () => ({
  debugLogger: { log: vi.fn(), debug: vi.fn() },
}));

class MockTransport extends EventEmitter implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start() {}
  async close() {}
  async send(_message: JSONRPCMessage) {}

  simulateError(error: Error) {
    this.onerror?.(error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  simulateMessage(msg: any) {
    this.onmessage?.(msg);
  }

  simulateClose() {
    this.onclose?.();
  }
}

describe('ResilientStdioTransport', () => {
  it('filters ZodError from reaching the outer onerror handler', () => {
    const mockTransport = new MockTransport();
    const wrapper = new ResilientStdioTransport(mockTransport);

    const errors: Error[] = [];
    wrapper.onerror = (error) => {
      errors.push(error);
    };

    // Simulate a ZodError (as thrown by JSONRPCMessageSchema.parse)
    const zodError = new Error('Invalid input');
    zodError.name = 'ZodError';

    mockTransport.simulateError(zodError);

    // ZodError should NOT reach the wrapper's onerror
    expect(errors).toHaveLength(0);
  });

  it('forwards non-ZodError errors to the outer onerror handler', () => {
    const mockTransport = new MockTransport();
    const wrapper = new ResilientStdioTransport(mockTransport);

    const errors: Error[] = [];
    wrapper.onerror = (error) => {
      errors.push(error);
    };

    const regularError = new Error('Connection failed');
    mockTransport.simulateError(regularError);

    // Regular errors should reach the wrapper's onerror
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(regularError);
  });

  it('forwards messages from the inner transport', () => {
    const mockTransport = new MockTransport();
    const wrapper = new ResilientStdioTransport(mockTransport);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    wrapper.onmessage = (msg) => {
      messages.push(msg);
    };

    const testMessage = { jsonrpc: '2.0', id: 1, result: {} };
    mockTransport.simulateMessage(testMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(testMessage);
  });

  it('forwards close events from the inner transport', () => {
    const mockTransport = new MockTransport();
    const wrapper = new ResilientStdioTransport(mockTransport);

    let closed = false;
    wrapper.onclose = () => {
      closed = true;
    };

    mockTransport.simulateClose();
    expect(closed).toBe(true);
  });

  it('delegates start, close, and send to the inner transport', async () => {
    const mockTransport = new MockTransport();
    const startSpy = vi.spyOn(mockTransport, 'start');
    const closeSpy = vi.spyOn(mockTransport, 'close');
    const sendSpy = vi.spyOn(mockTransport, 'send');

    const wrapper = new ResilientStdioTransport(mockTransport);

    await wrapper.start();
    expect(startSpy).toHaveBeenCalledOnce();

    const msg = { jsonrpc: '2.0' as const, method: 'test' };
    await wrapper.send(msg);
    expect(sendSpy).toHaveBeenCalledWith(msg);

    await wrapper.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('survives Protocol.connect chaining pattern', () => {
    const mockTransport = new MockTransport();
    const wrapper = new ResilientStdioTransport(mockTransport);

    // Simulate what Protocol.connect does:
    // 1. Read current onerror
    const _onerror = wrapper.onerror;
    // 2. Set new onerror that chains old + Protocol._onerror
    const protocolErrors: Error[] = [];
    wrapper.onerror = (error: Error) => {
      _onerror?.(error);
      // Simulate Protocol._onerror
      protocolErrors.push(error);
    };

    // Now simulate a ZodError from the inner transport
    const zodError = new Error('Invalid input');
    zodError.name = 'ZodError';
    mockTransport.simulateError(zodError);

    // ZodError should be filtered by the wrapper — Protocol._onerror never sees it
    expect(protocolErrors).toHaveLength(0);

    // Non-ZodError should pass through to Protocol
    const regularError = new Error('Real error');
    mockTransport.simulateError(regularError);
    expect(protocolErrors).toHaveLength(1);
    expect(protocolErrors[0]).toBe(regularError);
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useCallback } from 'react';
import {
  MessageBusType,
  type McpElicitationRequest,
  type Config,
} from '@google/gemini-cli-core';

export const useElicitation = (config: Config) => {
  const [pendingRequests, setPendingRequests] = useState<
    McpElicitationRequest[]
  >([]);

  const handleResponse = useCallback(
    async (
      correlationId: string,
      action: 'accept' | 'decline' | 'cancel',
      content?: Record<string, unknown>,
    ) => {
      const messageBus = config.getMessageBus();
      await messageBus.publish({
        type: MessageBusType.MCP_ELICITATION_RESPONSE,
        correlationId,
        action,
        content,
      });

      setPendingRequests((prev) =>
        prev.filter((r) => r.correlationId !== correlationId),
      );
    },
    [config],
  );

  useEffect(() => {
    const messageBus = config.getMessageBus();

    const handler = (request: McpElicitationRequest) => {
      setPendingRequests((prev) => [...prev, request]);
    };

    messageBus.subscribe<McpElicitationRequest>(
      MessageBusType.MCP_ELICITATION_REQUEST,
      handler,
    );

    return () => {
      messageBus.unsubscribe(MessageBusType.MCP_ELICITATION_REQUEST, handler);
    };
  }, [config]);

  return {
    pendingRequests,
    handleResponse,
  };
};

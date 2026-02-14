/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from './shared/RadioButtonSelect.js';
import { type McpElicitationUrlRequest } from '@google/gemini-cli-core';
import open from 'open';

export interface ElicitationUrlProps {
  request: McpElicitationUrlRequest;
  onAccept: () => void;
  onDecline: () => void;
  terminalWidth: number;
}

export const ElicitationUrl: React.FC<ElicitationUrlProps> = ({
  request,
  onAccept,
  onDecline,
}) => {
  const { url, message, serverName } = request;

  const options: Array<RadioSelectItem<string>> = [
    { label: 'Open URL and continue', value: 'accept', key: 'accept' },
    { label: 'Decline', value: 'decline', key: 'decline' },
  ];

  const handleSelect = (val: string) => {
    if (val === 'accept') {
      void open(url);
      onAccept();
    } else {
      onDecline();
    }
  };

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor={theme.border.default}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.text.primary}>
          Action required from MCP Server: {serverName}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={theme.text.secondary}>{message}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={theme.text.link}>{url}</Text>
      </Box>
      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused={true}
      />
    </Box>
  );
};

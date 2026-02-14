/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { AskUserDialog } from './AskUserDialog.js';
import { theme } from '../semantic-colors.js';
import {
  type McpElicitationFormRequest,
  QuestionType,
  type Question,
} from '@google/gemini-cli-core';

interface SchemaProperty {
  title?: string;
  description?: string;
  type?: string;
  enum?: string[];
  default?: unknown;
}

interface SchemaWithProperties {
  properties: Record<string, SchemaProperty>;
}

function hasProperties(schema: object): schema is SchemaWithProperties {
  return (
    'properties' in schema &&
    typeof schema['properties' as keyof typeof schema] === 'object'
  );
}

export interface ElicitationFormProps {
  request: McpElicitationFormRequest;
  onSubmit: (content: Record<string, unknown>) => void;
  onCancel: () => void;
  terminalWidth: number;
}

export const ElicitationForm: React.FC<ElicitationFormProps> = ({
  request,
  onSubmit,
  onCancel,
  terminalWidth,
}) => {
  const { requestedSchema, message, serverName } = request;

  const { questions, propertyNames } = useMemo(() => {
    const questions: Question[] = [];
    const propertyNames: string[] = [];

    // Simplistic schema-to-questions mapping
    if (
      requestedSchema &&
      typeof requestedSchema === 'object' &&
      hasProperties(requestedSchema)
    ) {
      const properties = requestedSchema.properties;

      for (const [key, prop] of Object.entries(properties)) {
        propertyNames.push(key);
        const header = prop.title || key;
        const questionText = prop.description || `Please provide ${key}`;

        if (prop.type === 'string' && prop.enum) {
          questions.push({
            type: QuestionType.CHOICE,
            header,
            question: questionText,
            options: prop.enum.map((e: string) => ({
              label: e,
              description: '',
            })),
          });
        } else if (prop.type === 'boolean') {
          questions.push({
            type: QuestionType.YESNO,
            header,
            question: questionText,
          });
        } else {
          // Default to text for string, number, integer, or unknown
          questions.push({
            type: QuestionType.TEXT,
            header,
            question: questionText,
            placeholder:
              prop.default !== undefined ? String(prop.default) : undefined,
          });
        }
      }
    }
    return { questions, propertyNames };
  }, [requestedSchema]);

  const handleSubmit = (answers: { [index: string]: string }) => {
    const content: Record<string, unknown> = {};
    for (const [indexStr, answer] of Object.entries(answers)) {
      const index = parseInt(indexStr, 10);
      const key = propertyNames[index];
      if (
        !requestedSchema ||
        typeof requestedSchema !== 'object' ||
        !hasProperties(requestedSchema)
      )
        return;
      const prop = requestedSchema.properties[key];

      // Basic type conversion
      if (prop.type === 'boolean') {
        content[key] = answer.toLowerCase() === 'yes';
      } else if (prop.type === 'number' || prop.type === 'integer') {
        const num = Number(answer);
        content[key] = isNaN(num) ? answer : num;
      } else {
        content[key] = answer;
      }
    }
    onSubmit(content);
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
          Input required from MCP Server: {serverName}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={theme.text.secondary}>{message}</Text>
      </Box>
      <AskUserDialog
        questions={questions}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        width={terminalWidth - 4} // adjust for padding and border
      />
    </Box>
  );
};

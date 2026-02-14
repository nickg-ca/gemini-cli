/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

const RelaxedElicitRequestSchema = z.object({
  method: z.literal('elicitation/create'),
  params: z.union([
    z.object({
      mode: z.literal('form'),
      message: z.string(),
      elicitationId: z.string().optional(),
      requestedSchema: z.record(z.unknown()).or(z.any()), // CURRENT BUGGY IMPLEMENTATION
    }),
    z.object({
      mode: z.literal('url'),
      message: z.string(),
      elicitationId: z.string().optional(),
      url: z.string().url(),
    }),
  ]),
});

const testCases = [
  {
    name: 'Form Mode - Missing Schema (Should Pass but Fails)',
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Please fill this form',
      elicitationId: '123',
      // requestedSchema is missing
    },
  },
];

testCases.forEach((testCase) => {
  try {
    RelaxedElicitRequestSchema.parse(testCase);
    console.log(`[PASS] ${testCase.name}`);
  } catch (e) {
    console.log(`[FAIL] ${testCase.name}`);
    if (e instanceof z.ZodError) {
      console.log(JSON.stringify(e.errors, null, 2));
    } else {
      console.log(e);
    }
  }
});

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { createLlmClient } from '../src/llm/client'
import { extractJsonObject, parseJsonResponse } from '../src/llm/json'
import type { LlmConfig } from '../src/llm/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: LlmConfig = {
  apiUrl: 'https://example.com/v1/chat/completions',
  apiKey: 'test-key',
  model: 'test-model',
  maxTokens: 1000,
  timeoutMs: 5000,
}

type FetchCall = { url: string; body: Record<string, unknown> }

function makeFetchMock(responses: Response[]): {
  calls: FetchCall[]
  restore: () => void
} {
  const calls: FetchCall[] = []
  let index = 0
  const original = globalThis.fetch
  globalThis.fetch = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : {}
      calls.push({ url, body })
      const response = responses[index] ?? responses[responses.length - 1]
      index += 1
      return response
    },
  ) as typeof globalThis.fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function makeOkResponse(content: string, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: finishReason }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function makeErrorResponse(status: number, body: string): Response {
  return new Response(body, { status })
}

// ---------------------------------------------------------------------------
// LlmClient — call()
// ---------------------------------------------------------------------------

describe('LlmClient.call', () => {
  test('sends correct request shape', async () => {
    const { calls, restore } = makeFetchMock([makeOkResponse('hello')])
    try {
      const client = createLlmClient(BASE_CONFIG)
      await client.call({
        messages: [{ role: 'user', content: 'ping' }],
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(BASE_CONFIG.apiUrl)
      expect(calls[0].body.model).toBe(BASE_CONFIG.model)
      expect(calls[0].body.max_tokens).toBe(BASE_CONFIG.maxTokens)
      expect(calls[0].body.messages).toEqual([
        { role: 'user', content: 'ping' },
      ])
    } finally {
      restore()
    }
  })

  test('returns content and finishReason', async () => {
    const { restore } = makeFetchMock([makeOkResponse('result text', 'stop')])
    try {
      const client = createLlmClient(BASE_CONFIG)
      const result = await client.call({
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(result.content).toBe('result text')
      expect(result.finishReason).toBe('stop')
    } finally {
      restore()
    }
  })

  test('per-call maxTokens overrides config default', async () => {
    const { calls, restore } = makeFetchMock([makeOkResponse('ok')])
    try {
      const client = createLlmClient(BASE_CONFIG)
      await client.call({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 500,
      })
      expect(calls[0].body.max_tokens).toBe(500)
    } finally {
      restore()
    }
  })

  test('throws on non-ok HTTP response', async () => {
    const { restore } = makeFetchMock([makeErrorResponse(429, 'rate limited')])
    try {
      const client = createLlmClient(BASE_CONFIG)
      await expect(
        client.call({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('LLM API error (429)')
    } finally {
      restore()
    }
  })

  test('throws when response content is missing', async () => {
    const { restore } = makeFetchMock([
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])
    try {
      const client = createLlmClient(BASE_CONFIG)
      await expect(
        client.call({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('LLM response missing content')
    } finally {
      restore()
    }
  })
})

// ---------------------------------------------------------------------------
// LlmClient — callWithRetry()
// ---------------------------------------------------------------------------

describe('LlmClient.callWithRetry', () => {
  test('returns immediately on stop', async () => {
    const { calls, restore } = makeFetchMock([makeOkResponse('done', 'stop')])
    try {
      const client = createLlmClient(BASE_CONFIG)
      const result = await client.callWithRetry({
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(calls).toHaveLength(1)
      expect(result.finishReason).toBe('stop')
    } finally {
      restore()
    }
  })

  test('bumps max_tokens and retries on length finish reason', async () => {
    const { calls, restore } = makeFetchMock([
      makeOkResponse('truncated', 'length'),
      makeOkResponse('complete', 'stop'),
    ])
    try {
      const client = createLlmClient(BASE_CONFIG)
      const result = await client.callWithRetry(
        { messages: [{ role: 'user', content: 'hi' }] },
        { tokenStep: 500 },
      )
      expect(calls).toHaveLength(2)
      expect(calls[0].body.max_tokens).toBe(BASE_CONFIG.maxTokens)
      expect(calls[1].body.max_tokens).toBe(BASE_CONFIG.maxTokens + 500)
      expect(result.finishReason).toBe('stop')
      expect(result.content).toBe('complete')
    } finally {
      restore()
    }
  })

  test('stops retrying when maxTokensCap is reached', async () => {
    const { calls, restore } = makeFetchMock([
      makeOkResponse('truncated', 'length'),
      makeOkResponse('still truncated', 'length'),
    ])
    try {
      const client = createLlmClient({ ...BASE_CONFIG, maxTokens: 900 })
      const result = await client.callWithRetry(
        { messages: [{ role: 'user', content: 'hi' }] },
        { tokenStep: 200, maxTokensCap: 1000 },
      )
      // 900 + 200 = 1100 > 1000 cap, so only one call
      expect(calls).toHaveLength(1)
      expect(result.finishReason).toBe('length')
    } finally {
      restore()
    }
  })

  test('config is frozen and not mutated by retry', async () => {
    const { restore } = makeFetchMock([
      makeOkResponse('truncated', 'length'),
      makeOkResponse('ok', 'stop'),
    ])
    try {
      const client = createLlmClient(BASE_CONFIG)
      await client.callWithRetry(
        { messages: [{ role: 'user', content: 'hi' }] },
        { tokenStep: 100 },
      )
      // config.maxTokens should be unchanged after retry
      expect(client.config.maxTokens).toBe(BASE_CONFIG.maxTokens)
    } finally {
      restore()
    }
  })
})

// ---------------------------------------------------------------------------
// extractJsonObject
// ---------------------------------------------------------------------------

describe('extractJsonObject', () => {
  test('returns clean JSON object unchanged', () => {
    const input = '{"key": "value"}'
    expect(extractJsonObject(input)).toBe(input)
  })

  test('strips surrounding text', () => {
    const input = 'Here is the result:\n{"key": "value"}\nThat is all.'
    expect(extractJsonObject(input)).toBe('{"key": "value"}')
  })

  test('strips markdown json fence', () => {
    const input = '```json\n{"key": "value"}\n```'
    expect(extractJsonObject(input)).toBe('{"key": "value"}')
  })

  test('strips plain markdown fence', () => {
    const input = '```\n{"key": "value"}\n```'
    expect(extractJsonObject(input)).toBe('{"key": "value"}')
  })

  test('throws when no object found', () => {
    expect(() => extractJsonObject('no json here')).toThrow(
      'does not contain a JSON object',
    )
  })

  test('handles nested objects', () => {
    const input = 'prefix {"outer": {"inner": 1}} suffix'
    const result = extractJsonObject(input)
    expect(JSON.parse(result)).toEqual({ outer: { inner: 1 } })
  })
})

// ---------------------------------------------------------------------------
// parseJsonResponse
// ---------------------------------------------------------------------------

describe('parseJsonResponse', () => {
  test('parses and validates a well-formed response', () => {
    const content = '{"focus": "test session", "confidence": "high"}'
    const result = parseJsonResponse(content, (raw) => {
      const rec = raw as Record<string, unknown>
      if (typeof rec.focus !== 'string') throw new Error('bad')
      return { focus: rec.focus, confidence: rec.confidence as string }
    })
    expect(result.focus).toBe('test session')
    expect(result.confidence).toBe('high')
  })

  test('throws when validate rejects the shape', () => {
    const content = '{"wrong": true}'
    expect(() =>
      parseJsonResponse(content, (raw) => {
        const rec = raw as Record<string, unknown>
        if (typeof rec.focus !== 'string')
          throw new Error('Missing focus field')
        return rec
      }),
    ).toThrow('Missing focus field')
  })

  test('throws on invalid JSON', () => {
    expect(() => parseJsonResponse('{"broken": }', (r) => r)).toThrow(
      'Failed to parse LLM JSON response',
    )
  })
})

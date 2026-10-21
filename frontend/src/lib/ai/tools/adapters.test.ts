/**
 * Guards the three wire formats one tool definition has to survive.
 *
 * The provider differences are asymmetric and silent: OpenAI serialises tool
 * arguments as a JSON *string*, Ollama hands back a parsed *object*, Anthropic
 * hides them in `input` on a `tool_use` content block, and only two of the three
 * thread results by id. A regression here does not throw, it makes the model
 * answer as if the tool returned nothing, so these tests pin the exact shapes
 * against realistic response bodies rather than against the helpers' own idea
 * of them.
 */

import { describe, it, expect } from 'vitest'

import {
  assistantTurnFor,
  coerceToolArgs,
  extractTextToolCall,
  isToolsUnsupportedError,
  parseAssistantText,
  parseToolCalls,
  toAnthropicTools,
  toOpenAiStyleTools,
  toolResultTurns,
  toolsForProvider,
  type ToolCallRequest,
} from './adapters'
import type { CatalogTool, ToolParameterSchema } from '@/lib/tools/types'

const nodeParams: ToolParameterSchema = {
  type: 'object',
  properties: {
    cluster: { type: 'string', description: 'Cluster name or id.' },
    limit: { type: 'integer', description: 'How many hosts to return.', default: 10 },
  },
  required: ['cluster'],
}

const listNodes: CatalogTool = {
  name: 'list_nodes',
  readOnly: true,
  description: 'List the hosts of a cluster with their load.',
  parameters: nodeParams,
  execute: async () => ({ nodes: [] }),
}

const listGuests: CatalogTool = {
  name: 'list_guests',
  readOnly: true,
  description: 'List the VMs and containers the caller may see.',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ guests: [] }),
}

describe('tool definitions on the wire', () => {
  it('wraps every tool in the function envelope for the OpenAI style', () => {
    expect(toOpenAiStyleTools([listNodes, listGuests])).toEqual([
      {
        type: 'function',
        function: {
          name: 'list_nodes',
          description: 'List the hosts of a cluster with their load.',
          parameters: nodeParams,
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_guests',
          description: 'List the VMs and containers the caller may see.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ])
  })

  it('flattens a tool to name, description and input_schema for Anthropic', () => {
    expect(toAnthropicTools([listNodes])).toEqual([
      {
        name: 'list_nodes',
        description: 'List the hosts of a cluster with their load.',
        input_schema: nodeParams,
      },
    ])
  })

  it('passes the parameter schema through untouched, not a copy', () => {
    // The schema is the contract the model reads; rebuilding it is how a
    // `required` or an `enum` quietly goes missing.
    expect(toOpenAiStyleTools([listNodes])[0].function.parameters).toBe(nodeParams)
    expect(toAnthropicTools([listNodes])[0].input_schema).toBe(nodeParams)
  })

  it('routes Ollama and OpenAI to the function envelope and Anthropic to the flat form', () => {
    expect(toolsForProvider('ollama', [listNodes])).toEqual(toOpenAiStyleTools([listNodes]))
    expect(toolsForProvider('openai', [listNodes])).toEqual(toOpenAiStyleTools([listNodes]))
    expect(toolsForProvider('anthropic', [listNodes])).toEqual(toAnthropicTools([listNodes]))
  })

  it('sends an empty tool list rather than nothing when there is no tool', () => {
    expect(toolsForProvider('openai', [])).toEqual([])
    expect(toolsForProvider('anthropic', [])).toEqual([])
  })
})

describe('argument coercion', () => {
  it('passes a plain object through', () => {
    const args = { cluster: 'lab', limit: 5 }

    expect(coerceToolArgs(args)).toEqual({ cluster: 'lab', limit: 5 })
    expect(coerceToolArgs(args)).toBe(args)
  })

  it('parses a JSON string of arguments', () => {
    expect(coerceToolArgs('{"cluster":"lab","limit":5}')).toEqual({ cluster: 'lab', limit: 5 })
  })

  it('tolerates whitespace around a JSON string', () => {
    expect(coerceToolArgs('  {"cluster":"lab"}\n')).toEqual({ cluster: 'lab' })
  })

  it('yields an empty object for every flavour of "no arguments"', () => {
    // A small local model emits all four of these for the same no-arg call.
    expect(coerceToolArgs('{}')).toEqual({})
    expect(coerceToolArgs('')).toEqual({})
    expect(coerceToolArgs('   ')).toEqual({})
    expect(coerceToolArgs(undefined)).toEqual({})
    expect(coerceToolArgs(null)).toEqual({})
  })

  it('drops a string that is not JSON instead of guessing a key name', () => {
    expect(coerceToolArgs('lab')).toEqual({})
    expect(coerceToolArgs('{cluster: lab}')).toEqual({})
  })

  it('drops an array, which is never an argument object', () => {
    expect(coerceToolArgs([{ cluster: 'lab' }])).toEqual({})
    expect(coerceToolArgs('[{"cluster":"lab"}]')).toEqual({})
    expect(coerceToolArgs([])).toEqual({})
  })

  it('drops a bare JSON scalar', () => {
    expect(coerceToolArgs('42')).toEqual({})
    expect(coerceToolArgs('"lab"')).toEqual({})
    expect(coerceToolArgs('null')).toEqual({})
  })
})

describe('reading tool calls out of a provider response', () => {
  it('takes Ollama arguments as the object they already are', () => {
    const body = {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'list_nodes', arguments: { cluster: 'lab', limit: 3 } } }],
      },
    }

    expect(parseToolCalls('ollama', body)).toEqual([
      { name: 'list_nodes', args: { cluster: 'lab', limit: 3 } },
    ])
  })

  it('parses the OpenAI JSON string of arguments and keeps the call id', () => {
    const body = {
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'list_nodes', arguments: '{"cluster":"lab","limit":3}' },
          }],
        },
      }],
    }

    // The id is what the tool result answers; losing it is a 400 from OpenAI.
    expect(parseToolCalls('openai', body)).toEqual([
      { id: 'call_1', name: 'list_nodes', args: { cluster: 'lab', limit: 3 } },
    ])
  })

  it('reads the Anthropic tool_use block, keeps its id and ignores the text block', () => {
    const body = {
      content: [
        { type: 'text', text: 'hm, let me look at the hosts.' },
        { type: 'tool_use', id: 'toolu_1', name: 'list_nodes', input: { cluster: 'lab' } },
      ],
    }

    expect(parseToolCalls('anthropic', body)).toEqual([
      { id: 'toolu_1', name: 'list_nodes', args: { cluster: 'lab' } },
    ])
  })

  it('reads several parallel calls in one response', () => {
    const body = {
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'list_nodes', input: {} },
        { type: 'tool_use', id: 'toolu_2', name: 'list_guests', input: { limit: 5 } },
      ],
    }

    expect(parseToolCalls('anthropic', body).map(c => c.name)).toEqual(['list_nodes', 'list_guests'])
  })

  it('returns no call for a plain text answer, whatever the provider', () => {
    expect(parseToolCalls('ollama', { message: { role: 'assistant', content: '12 hosts.' } })).toEqual([])
    expect(parseToolCalls('openai', { choices: [{ message: { role: 'assistant', content: '12 hosts.' } }] })).toEqual([])
    expect(parseToolCalls('anthropic', { content: [{ type: 'text', text: '12 hosts.' }] })).toEqual([])
  })

  it('returns no call for an empty or malformed body', () => {
    for (const provider of ['ollama', 'openai', 'anthropic'] as const) {
      expect(parseToolCalls(provider, {})).toEqual([])
      expect(parseToolCalls(provider, null)).toEqual([])
      expect(parseToolCalls(provider, { message: 'oops', content: 'oops', choices: 'oops' })).toEqual([])
    }
  })

  it('drops a call that carries no tool name', () => {
    const ollama = {
      message: {
        tool_calls: [
          { function: { arguments: { cluster: 'lab' } } },
          { function: { name: 'list_nodes', arguments: {} } },
        ],
      },
    }

    expect(parseToolCalls('ollama', ollama)).toEqual([{ name: 'list_nodes', args: {} }])

    const openai = {
      choices: [{ message: { tool_calls: [{ id: 'call_1', type: 'function', function: {} }] } }],
    }

    expect(parseToolCalls('openai', openai)).toEqual([])

    const anthropic = { content: [{ type: 'tool_use', id: 'toolu_1', input: {} }] }

    expect(parseToolCalls('anthropic', anthropic)).toEqual([])
  })
})

describe('reading the assistant text out of a provider response', () => {
  it('reads message.content for Ollama', () => {
    expect(parseAssistantText('ollama', { message: { content: 'pve1 is the busiest.' } }))
      .toBe('pve1 is the busiest.')
  })

  it('falls back to the Ollama generate-style response field', () => {
    // /api/generate and some proxies answer with `response` and no message.
    expect(parseAssistantText('ollama', { response: 'pve1 is the busiest.' }))
      .toBe('pve1 is the busiest.')
  })

  it('reads the first choice message for OpenAI', () => {
    expect(parseAssistantText('openai', { choices: [{ message: { content: 'pve1.' } }] })).toBe('pve1.')
  })

  it('joins every Anthropic text block and ignores the tool_use blocks', () => {
    const body = {
      content: [
        { type: 'text', text: 'pve1 is the busiest' },
        { type: 'tool_use', id: 'toolu_1', name: 'list_nodes', input: {} },
        { type: 'text', text: ', at 87% memory.' },
      ],
    }

    expect(parseAssistantText('anthropic', body)).toBe('pve1 is the busiest, at 87% memory.')
  })

  it('yields an empty string when there is no text at all', () => {
    expect(parseAssistantText('ollama', {})).toBe('')
    expect(parseAssistantText('openai', {})).toBe('')
    expect(parseAssistantText('openai', { choices: [{ message: { content: null } }] })).toBe('')
    expect(parseAssistantText('anthropic', {})).toBe('')
    expect(parseAssistantText('anthropic', { content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }] })).toBe('')
  })
})

describe('the assistant turn appended before the tool results', () => {
  it('echoes the OpenAI message object back verbatim', () => {
    const message = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_nodes', arguments: '{}' } }],
    }

    // OpenAI validates that a tool result answers a turn it produced, so the
    // original object has to travel back, not a reconstruction of it.
    expect(assistantTurnFor('openai', { choices: [{ message }] })).toBe(message)
  })

  it('rewraps the Anthropic content blocks in an assistant turn', () => {
    const content = [
      { type: 'text', text: 'checking' },
      { type: 'tool_use', id: 'toolu_1', name: 'list_nodes', input: {} },
    ]

    const turn = assistantTurnFor('anthropic', { content })

    expect(turn.role).toBe('assistant')
    expect(turn.content).toBe(content)
  })

  it('echoes the Ollama message object back', () => {
    const message = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_nodes' } }] }

    expect(assistantTurnFor('ollama', { message })).toBe(message)
  })

  it('falls back to an empty assistant turn when the body has no message', () => {
    expect(assistantTurnFor('openai', {})).toEqual({ role: 'assistant', content: '' })
    expect(assistantTurnFor('ollama', {})).toEqual({ role: 'assistant', content: '' })
    expect(assistantTurnFor('anthropic', {})).toEqual({ role: 'assistant', content: [] })
  })
})

describe('carrying tool results back to the model', () => {
  const results: Array<{ call: ToolCallRequest; content: string }> = [
    { call: { id: 'call_1', name: 'list_nodes', args: {} }, content: '{"nodes":["pve1"]}' },
    { call: { id: 'call_2', name: 'list_guests', args: {} }, content: '{"guests":[]}' },
  ]

  it('collapses every Anthropic result into one user turn of tool_result blocks', () => {
    const turns = toolResultTurns('anthropic', results)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: '{"nodes":["pve1"]}' },
        { type: 'tool_result', tool_use_id: 'call_2', content: '{"guests":[]}' },
      ],
    })
  })

  it('emits one tool message per result for OpenAI, keyed by call id', () => {
    expect(toolResultTurns('openai', results)).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '{"nodes":["pve1"]}' },
      { role: 'tool', tool_call_id: 'call_2', content: '{"guests":[]}' },
    ])
  })

  it('emits one tool message per result for Ollama, keyed by tool name', () => {
    // Ollama has no call id, so the name is the only disambiguator available.
    expect(toolResultTurns('ollama', results)).toEqual([
      { role: 'tool', tool_name: 'list_nodes', content: '{"nodes":["pve1"]}' },
      { role: 'tool', tool_name: 'list_guests', content: '{"guests":[]}' },
    ])
  })

  it('emits nothing for the other two providers and an empty Anthropic turn with no result', () => {
    expect(toolResultTurns('openai', [])).toEqual([])
    expect(toolResultTurns('ollama', [])).toEqual([])
    expect(toolResultTurns('anthropic', [])).toEqual([{ role: 'user', content: [] }])
  })
})

describe('recognising a provider that cannot do tools', () => {
  it('recognises the phrasings a model or gateway uses to refuse a tools payload', () => {
    const refusals = [
      'model does not support tools',
      'registry.ollama.ai/library/mistral:7b does not support tools',
      'llama2 does not support function calling',
      'tools is not supported for this model',
      'tool use is not supported by this deployment',
      "Unsupported parameter: 'tools' is not supported with this model",
      'unknown field "tools" in chat request',
    ]

    for (const message of refusals) {
      expect(isToolsUnsupportedError(message), message).toBe(true)
    }
  })

  it('is case insensitive', () => {
    expect(isToolsUnsupportedError('Model Does Not Support Tools')).toBe(true)
  })

  it('leaves an unrelated failure alone so it surfaces as a real error', () => {
    // Degrading on these would hide an outage behind a toolless answer.
    const realFailures = [
      'connection refused',
      'model not found, try pulling it first',
      'fetch failed',
      'context deadline exceeded',
      '401 unauthorized',
      'unsupported parameter: temperature',
      '',
    ]

    for (const message of realFailures) {
      expect(isToolsUnsupportedError(message), message).toBe(false)
    }
  })
})

/*
 * Recovering a tool call the model wrote as prose.
 *
 * Ollama only lifts a call out of the output when the call IS the whole output.
 * llama3.1 writes calls as {"name": ..., "parameters": {...}}, and one leading
 * sentence is enough for the parse to fail and the raw JSON to come back as
 * ordinary content. In recette that JSON printed verbatim in the chat window,
 * so this parser is the last line of defence, and its false positives matter as
 * much as its hits: mistaking quoted JSON for a call would fire a real query.
 */
describe('recovering a tool call written as text', () => {
  const known = ['get_ceph_status', 'rank_guest_hardware']

  it('recovers the exact shape seen in recette on llama3.1:8b', () => {
    const content = 'Voici la reponse :\n\n{"name": "get_ceph_status", "parameters": {"cluster": "PVE-CLUSTER", "focus": "improvements"}}'

    expect(extractTextToolCall(content, known)).toEqual({
      name: 'get_ceph_status',
      args: { cluster: 'PVE-CLUSTER', focus: 'improvements' },
    })
  })

  it('accepts arguments and input as well as parameters', () => {
    for (const key of ['parameters', 'arguments', 'input']) {
      const content = `{"name": "rank_guest_hardware", "${key}": {"metric": "vcpus"}}`

      expect(extractTextToolCall(content, known)?.args).toEqual({ metric: 'vcpus' })
    }
  })

  it('recovers a call carrying no argument object at all', () => {
    expect(extractTextToolCall('{"name": "get_ceph_status"}', known)).toEqual({
      name: 'get_ceph_status',
      args: {},
    })
  })

  it('handles nested objects and braces inside strings', () => {
    const content = 'ok {"name": "rank_guest_hardware", "parameters": {"metric": "vcpus", "note": "a } brace {", "deep": {"a": {"b": 1}}}}'
    const call = extractTextToolCall(content, known)

    expect(call?.name).toBe('rank_guest_hardware')
    expect(call?.args).toMatchObject({ metric: 'vcpus', note: 'a } brace {', deep: { a: { b: 1 } } })
  })

  it('skips a leading object that is not a call before finding the real one', () => {
    const content = '{"unrelated": true} then {"name": "get_ceph_status", "parameters": {}}'

    expect(extractTextToolCall(content, known)?.name).toBe('get_ceph_status')
  })

  it('ignores JSON naming something that is not one of our tools', () => {
    // A model quoting a bridge config must not trigger a query.
    const content = 'Exemple : {"name": "vmbr0", "parameters": {"mtu": 9000}}'

    expect(extractTextToolCall(content, known)).toBeNull()
  })

  it('ignores prose, empty input and unbalanced JSON', () => {
    expect(extractTextToolCall('Le cluster est en HEALTH_WARN.', known)).toBeNull()
    expect(extractTextToolCall('', known)).toBeNull()
    expect(extractTextToolCall('{"name": "get_ceph_status", "parameters": {', known)).toBeNull()
    expect(extractTextToolCall('{not json at all}', known)).toBeNull()
  })

  it('returns null when no tool is exposed, whatever the content says', () => {
    expect(extractTextToolCall('{"name": "get_ceph_status"}', [])).toBeNull()
  })
})

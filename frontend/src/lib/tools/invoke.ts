/**
 * The one way to run a catalog tool.
 *
 * Every consumer goes through `invokeTool`: the in-app assistant today, the
 * MCP endpoint for external agents later. That is where untrusted arguments
 * are checked and where a refusal is told apart from a failure, so a consumer
 * only decides how to hand the outcome back to its caller.
 */

import { AmbiguousTargetError, ToolArgumentError, ToolScopeError, type CatalogTool, type TargetChoice, type ToolContext } from '@/lib/tools/types'

export type ToolOutcome =
  | { ok: true; value: unknown }
  | {
      ok: false
      /** `out-of-scope` and `bad-argument` are answers the caller can act on; `failed` is not. */
      error: 'out-of-scope' | 'bad-argument' | 'failed'
      message: string
      /** The targets an ambiguous reference matched (`AmbiguousTargetError`), for the user to pick from. */
      choices?: TargetChoice[]
    }

/**
 * An argument the schema does not declare is a mistake to report, not to skip.
 *
 * Skipping it is what turned a recoverable error into a dead end: asked to
 * pass "cluster", llama3.1:8b sent `clusterName`, the tool ignored the key,
 * answered with the very same refusal, and the model concluded the refusal
 * was about something else. Empty values are tolerated: small models pad
 * calls with `""` and `null` for the arguments they do not use.
 */
function rejectUnknownArguments(tool: CatalogTool, args: Record<string, unknown>) {
  const known = Object.keys(tool.parameters.properties)

  // A schema declaring nothing cannot say what it accepts; every registered
  // tool declares its arguments, so this only ever concerns bare fixtures.
  if (known.length === 0) return

  const unknown = Object.keys(args).filter(key => !known.includes(key) && args[key] !== '' && args[key] !== null && args[key] !== undefined)

  if (unknown.length === 0) return

  throw new ToolArgumentError(
    `Unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.map(k => `"${k}"`).join(', ')} for ${tool.name}. Accepted arguments: ${known.join(', ')}.`
  )
}

export async function invokeTool(
  tool: CatalogTool,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  try {
    rejectUnknownArguments(tool, args)

    return { ok: true, value: await tool.execute(args, ctx) }
  } catch (e: any) {
    // A scope refusal or a rejected argument is a legitimate answer: the
    // caller asked for something outside its perimeter, or with a value the
    // tool cannot take, and must be told so in words it can act on. Anything
    // else is a real failure and stays generic.
    if (e instanceof ToolScopeError) {
      const choices = e instanceof AmbiguousTargetError && e.choices.length ? { choices: e.choices } : {}

      return { ok: false, error: 'out-of-scope', message: String(e.message || 'Out of scope.'), ...choices }
    }

    if (e instanceof ToolArgumentError) {
      return { ok: false, error: 'bad-argument', message: String(e.message || 'Invalid argument.') }
    }

    console.error(`[tools] ${tool.name} failed:`, e)

    return {
      ok: false,
      error: 'failed',
      message: `The "${tool.name}" lookup failed: ${String(e?.message || e).slice(0, 200)}`,
    }
  }
}

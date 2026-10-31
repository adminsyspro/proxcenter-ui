/**
 * Which vendor published an LLM, from its model name, so the settings can show
 * the vendor's logo next to it (Qwen, Llama, Mistral, Gemma, gpt-oss...).
 *
 * Pure: importable from client components. The icon is a CSS class of the
 * Iconify bundle (`src/assets/iconify-icons/bundle-icons-css.mjs`); every
 * class returned here must be listed there, or the logo renders empty.
 */

export type ModelVendor = { vendor: string; icon: string }

const GENERIC: ModelVendor = { vendor: 'generic', icon: 'ri-cpu-line' }

// First match wins: `codellama` must read as Meta before any other rule.
const RULES: Array<{ test: RegExp; vendor: ModelVendor }> = [
  { test: /^(qwen|qwq)/, vendor: { vendor: 'qwen', icon: 'logos-qwen-icon' } },
  { test: /^(llama|codellama)/, vendor: { vendor: 'meta', icon: 'logos-meta-icon' } },
  { test: /(mistral|mixtral|ministral|magistral|codestral|devstral|pixtral)/, vendor: { vendor: 'mistral', icon: 'logos-mistral-ai-icon' } },
  { test: /^gemini/, vendor: { vendor: 'google-gemini', icon: 'logos-google-gemini-icon' } },
  { test: /^(gemma|codegemma)/, vendor: { vendor: 'google', icon: 'logos-google-icon' } },
  { test: /^(gpt|o1|o3|o4|chatgpt)/, vendor: { vendor: 'openai', icon: 'simple-icons-openai' } },
  { test: /^claude/, vendor: { vendor: 'anthropic', icon: 'logos-claude-icon' } },
  { test: /^deepseek/, vendor: { vendor: 'deepseek', icon: 'logos-deepseek-icon' } },
  { test: /^phi/, vendor: { vendor: 'microsoft', icon: 'logos-microsoft-icon' } },
  { test: /^granite/, vendor: { vendor: 'ibm', icon: 'simple-icons-ibm' } },
  { test: /^(command|aya)/, vendor: { vendor: 'cohere', icon: 'logos-cohere-icon' } },
  { test: /nemotron/, vendor: { vendor: 'nvidia', icon: 'logos-nvidia' } },
]

/**
 * The vendor of a model name as Ollama, OpenAI or Anthropic list it:
 * `qwen3.5:9b`, `aratan/Ministral-3-14B`, `hf.co/org/Llama-3.1-8B`, `gpt-4.1`.
 * Anything unknown gets a neutral chip icon rather than a wrong logo.
 */
export function modelVendor(model: string | null | undefined): ModelVendor {
  const name = String(model ?? '').trim().toLowerCase()
  // A namespace (`aratan/`, `hf.co/org/`) says who uploaded it, not who made it.
  const base = name.slice(name.lastIndexOf('/') + 1)

  if (!base) return GENERIC

  return RULES.find(r => r.test.test(base))?.vendor ?? GENERIC
}

/** Every Iconify class `modelVendor` can return, for the bundle and its test. */
export const MODEL_VENDOR_ICONS: string[] = RULES.map(r => r.vendor.icon)

/**
 * Identifiers for the managed CLI install recipes in
 * `@shared/data/presets/codeCliTools`, which `BinaryManager` folds into its
 * fixed tool catalog. The Code page and CLI launcher are gone; this enum only
 * keys the mise recipes that remain installable.
 */
export enum CodeCli {
  CLAUDE_CODE = 'claude-code',
  OPENAI_CODEX = 'openai-codex',
  OPEN_CODE = 'opencode',
  OPENCLAW = 'openclaw',
  DEEPSEEK_HARNESS = 'deepseek-harness',
  GEMINI_CLI = 'gemini-cli',
  ANTIGRAVITY_CLI = 'antigravity-cli',
  QWEN_CODE = 'qwen-code',
  KIMI_CODE = 'kimi-code',
  QODER_CLI = 'qoder-cli',
  GITHUB_COPILOT_CLI = 'github-copilot-cli',
  PI = 'pi',
  HERMES = 'hermes',
  MINIMAX_CODE = 'minimax-code'
}

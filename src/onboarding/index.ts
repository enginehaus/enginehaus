/**
 * Enginehaus Onboarding Module
 *
 * Provides first-run experience functionality including:
 * - CLAUDE.md generation (and other LLM instruction files)
 * - Project initialization
 * - Tech stack detection
 * - Welcome task creation
 * - Cross-LLM onboarding templates
 */

export {
  generateClaudeMd,
  generateMinimalClaudeMd,
  generateEnginehausSection,
  updateEnginehausSection,
  detectBuildCommands,
  ClaudeMdOptions,
  BuildCommands,
} from './claude-md-generator.js';

export {
  initializeProject,
  detectTechStack,
  detectDomain,
  createEngineHausDir,
  createWelcomeTask,
  isEngineHausProject,
  getProjectMarker,
  InitializationResult,
  InitOptions,
} from './project-initializer.js';

// Cross-LLM onboarding templates
export {
  generateChatGPTInstructions,
  generateGeminiInstructions,
  generateMistralInstructions,
  generateCursorInstructions,
  generateContinueInstructions,
  getTemplateGenerator,
  getInstructionFilename,
  SUPPORTED_LLMS,
  LLMTemplateOptions,
} from './llm-templates.js';

// Claude Desktop instructions template
export {
  generateDesktopInstructions,
  generateMinimalDesktopInstructions,
  DesktopInstructionsOptions,
} from './desktop-instructions-template.js';

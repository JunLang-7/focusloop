import { fileURLToPath } from 'node:url';

/**
 * Workspace-wide source aliases so tests and bundlers always resolve
 * `@focusloop/*` to the live TypeScript sources (never to build output).
 */
const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export const focusloopAlias: Record<string, string> = {
  '@focusloop/shared-types': pkg('shared-types'),
  '@focusloop/learning-state': pkg('learning-state'),
  '@focusloop/continuity': pkg('continuity'),
  '@focusloop/intervention-policy': pkg('intervention-policy'),
  '@focusloop/material-parser': pkg('material-parser'),
  '@focusloop/agent-core': pkg('agent-core'),
  '@focusloop/persistence': pkg('persistence'),
  '@focusloop/llm-provider': pkg('llm-provider'),
};

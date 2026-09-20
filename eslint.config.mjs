import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      '**/.nx/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/e2e/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    /*
     * The renderer is sandboxed: `contextIsolation`, `nodeIntegration: false`, `sandbox: true`. It
     * cannot resolve `node:` anything, which means it cannot resolve the workspace packages that
     * reach for it either.
     *
     * `@focusloop/agent-core` is the one that caught somebody out — its entrypoint re-exports the
     * engine, which imports `node:crypto`. The typecheck did refuse that import, but only because the
     * renderer's tsconfig happens to carry no node types. That is an accident of configuration, not a
     * stated boundary, and it would stop refusing the day somebody added `"types": ["node"]`.
     *
     * `shared-types` is the one package allowed through: types, constants, and the few pure
     * derivations both sides must agree on. No I/O, no dependencies, no state.
     */
    files: ['apps/desktop/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@focusloop/*', '!@focusloop/shared-types'],
              message:
                'The renderer may only import @focusloop/shared-types. Anything else reaches node:, which a sandboxed renderer cannot resolve.',
            },
            {
              /*
               * The rule above bans the workspace packages, not the actual problem. `tsconfig.base.json`
               * carries `"types": ["node"]` and only `apps/desktop/tsconfig.app.json` overrides it to
               * empty, so the day somebody removes that override a renderer file could import
               * `node:crypto` and neither the typecheck nor the rule above would object. This is the
               * prohibition the first one stands in for.
               */
              group: ['node:*'],
              message:
                'A sandboxed renderer cannot resolve node: modules. The tsconfig only appears to enforce this.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Two documentation rules, chosen because they are the two that pay here.
     *
     * An exported class states what it is for. Exported functions are deliberately not included:
     * two thirds of them have no doc comment, and a rule demanding one would produce a few hundred
     * comments whose content is the function's own name — the kind of noise that review policy
     * already rejects. What a function documents about itself stays a review decision.
     *
     * A package entrypoint does carry a one-line summary, because that is what a reader opening the
     * package sees, but nothing enforces it: the only rule that could (`require-file-overview`)
     * wants a `@file` tag, which would be the only TSDoc tag in the codebase, added for a linter
     * rather than for a reader. The canonical description of what each package is for lives in
     * `docs/architecture.md`.
     */
    files: ['**/*.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          // `require` rather than `contexts`: the rule checks function declarations by default, and
          // `contexts` adds to that set instead of replacing it — which is how the first attempt at
          // this rule demanded docs on every exported function in the workspace.
          require: {
            FunctionDeclaration: false,
            MethodDefinition: false,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/main/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);

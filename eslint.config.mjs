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

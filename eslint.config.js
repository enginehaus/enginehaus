import tseslint from 'typescript-eslint';

export default [
  { ignores: ['build/**', 'node_modules/**', 'web/**'] },
  // Architecture enforcement: interface layers cannot import storage directly
  {
    files: [
      'src/bin/enginehaus.ts',
      'src/bin/commands/**/*.ts',
      'src/index.ts',
      'src/adapters/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/storage/*', '**/storage/**', '**/sqlite-storage*'],
          message: 'Interface files must use CoordinationService, not direct storage access. See docs/ARCHITECTURE.md.',
        }],
      }],
    },
  },
];

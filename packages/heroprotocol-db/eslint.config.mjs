import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.json', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-extra-semi': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The model, the normalizer and the analyser framework are pure: they know nothing
    // about the store. Only src/db (Stage 3) may import Dexie.
    files: ['src/model/**/*.ts', 'src/normalize/**/*.ts', 'src/analysers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'dexie', message: 'The model, normalizer and analysers are store-agnostic.' }] },
      ],
    },
  },
];

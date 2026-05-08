export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'dist/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        localStorage: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        alert: 'readonly',
        console: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        Array: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
    },
  },
];

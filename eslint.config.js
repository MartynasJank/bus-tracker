import js from '@eslint/js';

export default [
  js.configs.recommended,

  // Server-side files
  {
    files: ['server.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },

  // Client-side files
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        L: 'readonly',
        Promise: 'readonly',
        URL: 'readonly',
        Set: 'readonly',
        Map: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        Intl: 'readonly',
        isNaN: 'readonly',
        String: 'readonly',
        encodeURIComponent: 'readonly',
        decodeURIComponent: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
];

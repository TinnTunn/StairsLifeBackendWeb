// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Exclude file yang tidak perlu di-lint
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'node_modules/**',
      // test/app.e2e-spec.ts butuh tsconfig terpisah (tsconfig.test.json).
      // Sampai test e2e diaktifkan, exclude saja.
      'test/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Disable karena banyak kode legacy pakai `any` secara eksplisit
      '@typescript-eslint/no-explicit-any': 'off',

      // Warn saja (bukan error) — Prisma result types seringkali any
      // sampai prisma generate dijalankan di environment masing-masing
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Floating promise penting tapi tidak perlu block lint
      '@typescript-eslint/no-floating-promises': 'warn',

      // Repository pattern: method `async fooById()` return `this.prisma.foo.findUnique(...)`
      // tanpa await — sengaja, karena Prisma return Promise yang langsung di-chain.
      // Plus, ini false alarm kalau `prisma generate` belum dijalankan
      // (Prisma types jadi `error typed` → eslint tidak tahu return-nya Promise).
      '@typescript-eslint/require-await': 'warn',

      // Suppress false alarm dari Prisma adapter pattern
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',

      // Convention: variable/argument yang dimulai dengan `_` adalah
      // intentionally unused (e.g., decorator-required tapi tidak dipakai).
      // Override no-unused-vars built-in eslint:
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern:           '^_',
          varsIgnorePattern:           '^_',
          caughtErrorsIgnorePattern:   '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,   // const { secret, ...rest } = obj → secret OK unused
        },
      ],

      // Prettier line ending cross-platform
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // Test files — lebih longgar, plus exclude dari project service
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);

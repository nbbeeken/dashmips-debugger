module.exports = {
    env: {
        browser: true,
        es6: true,
    },
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/eslint-recommended'],
    globals: {
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint', 'prettier'],
    rules: {
        'prettier/prettier': ['error'],
        'prefer-const': ['warn'],
        'no-var': ['error'],
        'eol-last': ['error', 'always'],
        'no-unused-vars': 0,
        'sort-imports': 0,
    },
}

module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        // "No `any`" is a project rule: use `unknown` and narrow.
        '@typescript-eslint/no-explicit-any': 'error',
      },
    },
  ],
};

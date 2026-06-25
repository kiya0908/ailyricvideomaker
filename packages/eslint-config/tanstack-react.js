import eslintConfigPrettier from 'eslint-config-prettier'
import pluginReact from 'eslint-plugin-react'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { tanstackConfig } from '@tanstack/eslint-config'

/**
 * TanStack's strict JS/TS/import/node rules + React/Hooks + Prettier alignment.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const tanstackReactConfig = [
  {
    name: 'workspace/extra-ignores',
    ignores: ['**/eslint.config.js', '**/worker-configuration.d.ts'],
  },
  ...tanstackConfig,

  // React recommended rules
  pluginReact.configs.flat.recommended,
  {
    name: 'workspace/react-globals',
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  {
    name: 'workspace/react-hooks',
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // Ensure formatting is handled by Prettier
  eslintConfigPrettier,
]

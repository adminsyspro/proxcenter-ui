// Flat ESLint config (ESLint 9 + eslint-config-next 16).
//
// Replaces the legacy `.eslintrc.js`: eslint-config-next 16 ships an ESLint
// *flat config* only and requires ESLint >= 9, so the old eslintrc-format file
// (loaded by ESLint 8) could no longer be parsed — the linter had been silently
// broken since that dependency bump. Rules are carried over from that file,
// except the never-enforced formatting rules which are turned off (see below) to
// avoid a mass reformat. Ordering follows the old `extends` -> `rules`
// precedence (later flat-config entries win), so `prettier` sits BEFORE the
// project rules block.

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import importPlugin from 'eslint-plugin-import'
import prettier from 'eslint-config-prettier/flat'

const STRICT_TS_FILES = [
  // Lot 1 (roadmap#165): shared modules.
  'src/configs/globalThemesConfig.ts',
  'src/configs/lightBackgroundConfig.ts',
  'src/configs/primaryColorConfig.ts',
  'src/configs/themeConfig.ts',
  'src/contexts/LocaleContext.tsx',
  'src/contexts/PageTitleContext.tsx',
  'src/contexts/RBACContext.tsx',
  'src/@core/hooks/useObjectCookie.ts',
  'src/@core/utils/serverHelpers.ts',
  'src/@menu/utils/menuClasses.ts',
  'src/@menu/hooks/useMediaQuery.ts',
  'src/@layouts/utils/layoutClasses.ts',
  'src/utils/string.ts',
  'src/components/dashboard/widgets/themeColors.ts',
  'src/components/dashboard/widgets/timeRangeUtils.ts',
  'src/components/dashboard/widgets/useNodeTrends.ts',
  // Converted with the backup job creation fix.
  'src/app/(dashboard)/operations/backups/BackupJobsTabs.tsx',
]

const config = [
  // Was `ignorePatterns`. node_modules is ignored by default in flat config.
  // `public/**` holds vendored third-party code (noVNC) that must not be linted.
  {
    ignores: ['next-env.d.ts', '.next/**', 'coverage/**', 'public/**'],
  },

  // `extends: ["next/core-web-vitals"]` — registers the react, react-hooks,
  // import, jsx-a11y and @next/next plugins plus their rule sets.
  ...nextCoreWebVitals,

  // `extends: ["plugin:import/recommended"]` — next registers the `import`
  // plugin but not its recommended rules. Add only the rules; re-registering
  // the plugin here would throw "Cannot redefine plugin 'import'".
  {
    rules: {
      ...importPlugin.configs.recommended.rules,
    },
  },

  // `extends: ["prettier"]` — turn off formatting rules that conflict with
  // Prettier. Must come before the project rules so the explicit stylistic
  // rules below still win (mirrors the old eslintrc `extends` then `rules`).
  prettier,

  // The project `rules` + `settings` blocks, carried over from the old config
  // (never-enforced formatting rules relaxed; see the notes inline below).
  {
    rules: {
      'jsx-a11y/alt-text': 'off',
      'react/display-name': 'off',
      'react/no-children-prop': 'off',
      '@next/next/no-img-element': 'off',
      '@next/next/no-page-custom-font': 'off',
      'import/no-named-as-default': 'off',
      // Formatting rules carried over from the old .eslintrc.js that were never
      // actually enforced (the linter was broken well before this migration and
      // there is no CI lint step, so ~16.8k pre-existing violations accumulated).
      // Turned OFF to restore a usable linter WITHOUT a ~1190-file reformat that
      // would conflict with every in-flight branch. Re-enable later via a
      // dedicated `eslint --fix` pass once in-flight work has landed.
      'lines-around-comment': 'off',
      'padding-line-between-statements': 'off',
      'newline-before-return': 'off',
      'import/newline-after-import': 'off',
      'import/order': 'off',

      // eslint-config-next 16 bundles eslint-plugin-react-hooks v7, which adds
      // React-Compiler rules that did not exist under the previous plugin. Keep
      // them visible as warnings (they surface real issues) without blocking on
      // ~500 pre-existing hits. Promote to error incrementally as they're fixed.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        node: {},
        typescript: { project: './jsconfig.json' },
      },
    },
  },

  // Files converted to strict TypeScript (roadmap#171): no `any` and no
  // `@ts-*` escape hatch, so the strict ratchet (npm run typecheck:strict)
  // cannot be bypassed. Each conversion lot appends its files here.
  {
    files: STRICT_TS_FILES,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
]

export default config

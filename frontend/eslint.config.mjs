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
  // Lot 2 (roadmap#171): template core, menu and layouts.
  'src/@core/components/scroll-to-top/index.tsx',
  'src/@core/contexts/settingsContext.tsx',
  'src/@core/hooks/useLayoutInit.ts',
  'src/@core/hooks/useSettings.tsx',
  'src/@core/styles/horizontal/menuItemStyles.ts',
  'src/@core/styles/horizontal/menuRootStyles.ts',
  'src/@core/styles/vertical/menuItemStyles.ts',
  'src/@core/styles/vertical/menuSectionStyles.ts',
  'src/@core/styles/vertical/navigationCustomStyles.ts',
  'src/@core/theme/colorSchemes.ts',
  'src/@core/theme/customShadows.ts',
  'src/@core/theme/index.ts',
  'src/@core/theme/overrides/accordion.tsx',
  'src/@core/theme/overrides/alerts.tsx',
  'src/@core/theme/overrides/autocomplete.tsx',
  'src/@core/theme/overrides/avatar.ts',
  'src/@core/theme/overrides/backdrop.ts',
  'src/@core/theme/overrides/badges.ts',
  'src/@core/theme/overrides/breadcrumbs.ts',
  'src/@core/theme/overrides/button-group.ts',
  'src/@core/theme/overrides/button.ts',
  'src/@core/theme/overrides/card.ts',
  'src/@core/theme/overrides/checkbox.tsx',
  'src/@core/theme/overrides/chip.ts',
  'src/@core/theme/overrides/dialog.ts',
  'src/@core/theme/overrides/drawer.ts',
  'src/@core/theme/overrides/fab.ts',
  'src/@core/theme/overrides/form-control-label.ts',
  'src/@core/theme/overrides/icon-button.ts',
  'src/@core/theme/overrides/index.ts',
  'src/@core/theme/overrides/input.ts',
  'src/@core/theme/overrides/list.ts',
  'src/@core/theme/overrides/menu.ts',
  'src/@core/theme/overrides/pagination.ts',
  'src/@core/theme/overrides/paper.ts',
  'src/@core/theme/overrides/popover.ts',
  'src/@core/theme/overrides/progress.ts',
  'src/@core/theme/overrides/radio.tsx',
  'src/@core/theme/overrides/rating.tsx',
  'src/@core/theme/overrides/select.tsx',
  'src/@core/theme/overrides/slider.ts',
  'src/@core/theme/overrides/snackbar.ts',
  'src/@core/theme/overrides/switch.ts',
  'src/@core/theme/overrides/table-pagination.ts',
  'src/@core/theme/overrides/tabs.ts',
  'src/@core/theme/overrides/timeline.ts',
  'src/@core/theme/overrides/toggle-button.ts',
  'src/@core/theme/overrides/tooltip.ts',
  'src/@core/theme/overrides/typography.ts',
  'src/@core/theme/shadows.ts',
  'src/@core/theme/spacing.ts',
  'src/@core/theme/types.ts',
  'src/@core/theme/typography.ts',
  'src/@layouts/BlankLayout.tsx',
  'src/@layouts/HorizontalLayout.tsx',
  'src/@layouts/LayoutWrapper.tsx',
  'src/@layouts/VerticalLayout.tsx',
  'src/@layouts/components/horizontal/Header.tsx',
  'src/@layouts/components/horizontal/LayoutContent.tsx',
  'src/@layouts/components/horizontal/Navbar.tsx',
  'src/@layouts/components/vertical/LayoutContent.tsx',
  'src/@layouts/components/vertical/Navbar.tsx',
  'src/@layouts/styles/horizontal/StyledContentWrapper.tsx',
  'src/@layouts/styles/horizontal/StyledHeader.tsx',
  'src/@layouts/styles/shared/StyledMain.tsx',
  'src/@layouts/styles/vertical/StyledContentWrapper.tsx',
  'src/@layouts/styles/vertical/StyledHeader.tsx',
  'src/@menu/components/RouterLink.tsx',
  'src/@menu/components/horizontal-menu/HorizontalNav.tsx',
  'src/@menu/components/horizontal-menu/Menu.tsx',
  'src/@menu/components/horizontal-menu/MenuButton.tsx',
  'src/@menu/components/horizontal-menu/MenuItem.tsx',
  'src/@menu/components/horizontal-menu/SubMenu.tsx',
  'src/@menu/components/horizontal-menu/SubMenuContent.tsx',
  'src/@menu/components/horizontal-menu/VerticalNavInHorizontal.tsx',
  'src/@menu/components/vertical-menu/Menu.tsx',
  'src/@menu/components/vertical-menu/MenuButton.tsx',
  'src/@menu/components/vertical-menu/MenuItem.tsx',
  'src/@menu/components/vertical-menu/MenuSection.tsx',
  'src/@menu/components/vertical-menu/NavCollapseIcons.tsx',
  'src/@menu/components/vertical-menu/NavHeader.tsx',
  'src/@menu/components/vertical-menu/SubMenu.tsx',
  'src/@menu/components/vertical-menu/SubMenuContent.tsx',
  'src/@menu/components/vertical-menu/VerticalNav.tsx',
  'src/@menu/contexts/horizontalNavContext.tsx',
  'src/@menu/contexts/verticalNavContext.tsx',
  'src/@menu/defaultConfigs.ts',
  'src/@menu/hooks/useHorizontalMenu.tsx',
  'src/@menu/hooks/useHorizontalNav.tsx',
  'src/@menu/hooks/useVerticalMenu.tsx',
  'src/@menu/hooks/useVerticalNav.tsx',
  'src/@menu/horizontal-menu/index.tsx',
  'src/@menu/menuData.ts',
  'src/@menu/styles/StyledBackdrop.tsx',
  'src/@menu/styles/StyledMenuIcon.tsx',
  'src/@menu/styles/StyledMenuLabel.tsx',
  'src/@menu/styles/StyledMenuPrefix.tsx',
  'src/@menu/styles/StyledMenuSectionLabel.tsx',
  'src/@menu/styles/StyledMenuSuffix.tsx',
  'src/@menu/styles/StyledSubMenuContent.tsx',
  'src/@menu/styles/horizontal/StyledHorizontalMenu.tsx',
  'src/@menu/styles/horizontal/StyledHorizontalMenuItem.tsx',
  'src/@menu/styles/horizontal/StyledHorizontalNav.tsx',
  'src/@menu/styles/horizontal/StyledHorizontalNavExpandIcon.tsx',
  'src/@menu/styles/horizontal/StyledHorizontalSubMenuContent.tsx',
  'src/@menu/styles/horizontal/StyledHorizontalSubMenuContentWrapper.tsx',
  'src/@menu/styles/vertical/StyledVerticalMenu.tsx',
  'src/@menu/styles/vertical/StyledVerticalMenuItem.tsx',
  'src/@menu/styles/vertical/StyledVerticalMenuSection.tsx',
  'src/@menu/styles/vertical/StyledVerticalNav.tsx',
  'src/@menu/styles/vertical/StyledVerticalNavBgColorContainer.tsx',
  'src/@menu/styles/vertical/StyledVerticalNavContainer.tsx',
  'src/@menu/styles/vertical/StyledVerticalNavExpandIcon.tsx',
  'src/@menu/svg/ChevronRight.tsx',
  'src/@menu/svg/Close.tsx',
  'src/@menu/svg/RadioCircle.tsx',
  'src/@menu/svg/RadioCircleMarked.tsx',
  'src/@menu/types.ts',
  'src/@menu/utils/menuUtils.tsx',
  'src/@menu/vertical-menu/index.tsx',
  // Lot 2, second half: root pages, layout, login, profile and security components.
  'src/app/(blank-layout-pages)/access/page.tsx',
  'src/app/(blank-layout-pages)/layout.tsx',
  'src/app/(blank-layout-pages)/login/page.tsx',
  'src/app/(blank-layout-pages)/logout/page.tsx',
  'src/app/(blank-layout-pages)/profile/2fa/enrollment/page.tsx',
  'src/app/(blank-layout-pages)/setup/page.tsx',
  'src/app/(fullscreen)/console/[type]/[node]/[vmid]/page.tsx',
  'src/app/(fullscreen)/layout.tsx',
  'src/app/[...not-found]/page.tsx',
  'src/app/error.tsx',
  'src/app/global-error.tsx',
  'src/app/layout.tsx',
  'src/app/not-found.tsx',
  'src/app/page.tsx',
  'src/components/AuthProvider.tsx',
  'src/components/ErrorPage.tsx',
  'src/components/GenerateMenu.tsx',
  'src/components/LoginBackground.tsx',
  'src/components/OnboardingGuard.tsx',
  'src/components/Providers.tsx',
  'src/components/SessionExpiryGuard.tsx',
  'src/components/common/ColorPicker.tsx',
  'src/components/layout/horizontal/BurgerMenu.tsx',
  'src/components/layout/horizontal/Header.tsx',
  'src/components/layout/horizontal/HorizontalMenu.tsx',
  'src/components/layout/horizontal/Navigation.tsx',
  'src/components/layout/horizontal/VerticalNavContent.tsx',
  'src/components/layout/shared/Logo.tsx',
  'src/components/layout/shared/TenantSwitcher.tsx',
  'src/components/layout/shared/ThemeDropdown.tsx',
  'src/components/layout/shared/VdcSwitcher.tsx',
  'src/components/layout/shared/scrollSource.ts',
  'src/components/layout/vertical/Navbar.tsx',
  'src/components/layout/vertical/Navigation.tsx',
  'src/components/layout/vertical/VerticalMenu.tsx',
  'src/components/login/LoginAuthTabs.tsx',
  'src/components/login/LoginCredentialsForm.tsx',
  'src/components/login/LoginFooter.tsx',
  'src/components/login/LoginFormPanel.tsx',
  'src/components/login/LoginShell.tsx',
  'src/components/login/LoginSsoButton.tsx',
  'src/components/login/types.ts',
  'src/components/profile/SessionsCard.tsx',
  'src/components/profile/TwoFactorCard.tsx',
  'src/components/profile/TwoFactorEnrollWizard.tsx',
  'src/components/profile/TwoFactorReauthDialog.tsx',
  'src/components/security/RevokeEverySessionDialog.tsx',
  'src/components/security/RevokeSessionsDialog.tsx',
  'src/components/security/RevokeSingleSessionDialog.tsx',
  'src/components/tasks/JobChips.tsx',
  'src/components/theme/ModeChanger.tsx',
  'src/views/Login.tsx',
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

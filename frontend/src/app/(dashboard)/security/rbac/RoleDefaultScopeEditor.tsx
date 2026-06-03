'use client'

import { useEffect, useMemo, useState } from 'react'

import { Box, FormControl, InputLabel, Select, MenuItem, Button, Chip, Typography, Paper } from '@mui/material'

import { buildScopeOptions, resolveScopeTargetLabel } from './scope-options'

export type RoleScopeEntry = { scopeType: string; scopeTarget: string }

// Scope types a role default scope may carry — mirrors ROLE_DEFAULT_SCOPE_TYPES
// on the backend (no global, no inherit).
const TYPES = ['tag', 'pool', 'node', 'connection', 'vm'] as const

const typeIcon: Record<string, string> = {
  tag: 'ri-price-tag-3-line',
  pool: 'ri-folder-shared-line',
  node: 'ri-computer-line',
  connection: 'ri-server-line',
  vm: 'ri-instance-line',
}

/**
 * Editor for a custom role's default scope (issue #383). Builds a list of
 * { scopeType, scopeTarget } entries from the live inventory; any assignment
 * with scope_type "inherit" then follows this scope automatically.
 */
export default function RoleDefaultScopeEditor({
  value,
  onChange,
  t,
}: {
  value: RoleScopeEntry[]
  onChange: (scopes: RoleScopeEntry[]) => void
  t: any
}) {
  const [inventory, setInventory] = useState<any>(null)
  const [type, setType] = useState<string>('tag')
  const [target, setTarget] = useState<string>('')

  useEffect(() => {
    let active = true
    fetch('/api/v1/inventory')
      .then(r => r.json())
      .then(d => { if (active) setInventory(d?.data ?? d) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const options = useMemo(() => buildScopeOptions(inventory, type, t), [inventory, type, t])

  const has = (st: string, tgt: string) => value.some(s => s.scopeType === st && s.scopeTarget === tgt)

  const add = () => {
    if (!target || has(type, target)) return
    onChange([...value, { scopeType: type, scopeTarget: target }])
    setTarget('')
  }

  const remove = (st: string, tgt: string) =>
    onChange(value.filter(s => !(s.scopeType === st && s.scopeTarget === tgt)))

  const labelFor = (st: string) => t(`rbac.scopes.${st === 'vm' ? 'vmct' : st}`)

  return (
    <Box>
      <Typography variant='caption' sx={{ display: 'block', mb: 1, opacity: 0.7 }}>
        {t('rbacPage.defaultScope.desc')}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
        <FormControl size='small' sx={{ minWidth: 150 }}>
          <InputLabel>{t('rbacPage.scope')}</InputLabel>
          <Select
            value={type}
            label={t('rbacPage.scope')}
            onChange={e => { setType(e.target.value); setTarget('') }}
          >
            {TYPES.map(ty => (
              <MenuItem key={ty} value={ty}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className={typeIcon[ty]} style={{ opacity: 0.7 }} />
                  {labelFor(ty)}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size='small' sx={{ flex: 1 }}>
          <InputLabel>{t('navigation.resources')}</InputLabel>
          <Select
            value={target}
            label={t('navigation.resources')}
            onChange={e => setTarget(e.target.value)}
            disabled={!inventory}
            // Single-line closed value (icon + label, drop the sublabel) so this
            // select keeps the exact same height as the Scope one beside it.
            renderValue={val => {
              const o = options.find(opt => opt.id === val)

              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className={o?.icon || typeIcon[type]} style={{ opacity: 0.6 }} />
                  {o?.label ?? String(val)}
                </Box>
              )
            }}
          >
            {options.map(o => (
              <MenuItem key={o.id} value={o.id} disabled={has(type, o.id)}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className={o.icon || typeIcon[type]} style={{ opacity: 0.6 }} />
                  {o.label}
                  {o.sublabel && <Typography component='span' variant='caption' sx={{ opacity: 0.6 }}>{o.sublabel}</Typography>}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button variant='outlined' onClick={add} disabled={!target} sx={{ alignSelf: 'stretch' }}>
          {t('common.add')}
        </Button>
      </Box>

      {value.length > 0 ? (
        <Paper variant='outlined' sx={{ p: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {value.map(s => (
            <Chip
              key={`${s.scopeType}:${s.scopeTarget}`}
              size='small'
              icon={<i className={typeIcon[s.scopeType] || 'ri-price-tag-3-line'} style={{ fontSize: 14 }} />}
              label={`${labelFor(s.scopeType)}: ${resolveScopeTargetLabel(inventory, s.scopeType, s.scopeTarget, t)}`}
              onDelete={() => remove(s.scopeType, s.scopeTarget)}
              variant='outlined'
            />
          ))}
        </Paper>
      ) : (
        <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.defaultScope.none')}</Typography>
      )}
    </Box>
  )
}

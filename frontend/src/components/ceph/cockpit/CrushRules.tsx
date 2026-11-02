'use client'

import { Box, ButtonBase, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { poolTolerance, ruleFailureDomain, type CrushBucket, type CrushRule, type CrushStep, type Tolerance } from '@/lib/ceph/crushRules'

import { Tag, TABULAR } from './ui'
import type { Pool } from './PoolParts'

/*
   Rules half of the CRUSH tab: each rule of the decompiled CRUSH map with its steps in
   plain words, its device class, the pools that use it and, for each pool, the sentence
   about the failures it tolerates. Read only.
*/

const DOMAINS = ['osd', 'host', 'chassis', 'rack', 'row', 'pdu', 'pod', 'room', 'datacenter', 'zone', 'region', 'root']
const STEP_KEYS = ['take', 'emit', 'choose_firstn', 'choose_indep', 'chooseleaf_firstn', 'chooseleaf_indep']

/** The name of a bucket type for `count` of them ("2 racks"); an unknown type is shown as the map writes it. */
export function useDomainLabel() {
  const t = useTranslations('cephCockpit')

  return (type: string, count: number) => (DOMAINS.includes(type) ? t(`crush.domain.${type}`, { count }) : type)
}

function stepKey(op: string): string {
  if (STEP_KEYS.includes(op)) return op

  return op.startsWith('set_') ? 'set' : 'other'
}

/** `num` of a choose step: 0 = one per replica, negative = all replicas but |num|, positive = that many. */
function stepKind(step: CrushStep): { kind: 'all' | 'less' | 'count'; num: number } {
  const n = step.num ?? 0

  if (n === 0) return { kind: 'all', num: 0 }

  return n < 0 ? { kind: 'less', num: -n } : { kind: 'count', num: n }
}

function StepText({ step }: { step: CrushStep }) {
  const t = useTranslations('cephCockpit')
  const domain = useDomainLabel()
  const key = stepKey(step.op)

  if (key === 'take') return <>{t('crush.step.take', { item: step.item ?? '', class: step.deviceClass ?? 'none' })}</>
  if (key === 'emit') return <>{t('crush.step.emit')}</>
  if (key === 'set' || key === 'other') return <>{t(`crush.step.${key}`, { op: step.op })}</>

  const { kind, num } = stepKind(step)

  return <>{t(`crush.step.${key}`, { kind, num, type: domain(step.type ?? 'osd', kind === 'count' ? num : 1) })}</>
}

const TONE: Record<Tolerance['level'], { icon: string; color: string }> = {
  tolerates: { icon: 'ri-shield-check-line', color: 'success.main' },
  blocks: { icon: 'ri-error-warning-line', color: 'warning.main' },
  insufficient: { icon: 'ri-error-warning-line', color: 'error.main' },
  unknown: { icon: 'ri-question-line', color: 'text.disabled' },
}

function toleranceText(t: ReturnType<typeof useTranslations>, domain: ReturnType<typeof useDomainLabel>, tol: Tolerance): string {
  switch (tol.level) {
    case 'tolerates':
      return t('crush.tolerance.tolerates', { count: tol.tolerated, domain: domain(tol.domain, tol.tolerated) })
    case 'blocks':
      return t('crush.tolerance.blocks', { needed: tol.needed, domains: tol.domains, domain: domain(tol.domain, 1) })
    case 'insufficient':
      return t('crush.tolerance.insufficient', { needed: tol.needed, domains: tol.domains, domain: domain(tol.domain, tol.needed) })
    default:
      return t('crush.tolerance.unknown')
  }
}

function PoolTolerance({ pool, rule, buckets }: { pool: Pool; rule: CrushRule; buckets: CrushBucket[] }) {
  const t = useTranslations('cephCockpit')
  const domain = useDomainLabel()
  const tol = poolTolerance(pool, rule, buckets)
  const tone = TONE[tol.level]

  return (
    <Box data-testid='crush-tolerance' data-level={tol.level} data-pool={pool.name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 1, fontSize: 12.5 }}>
      <i className={tone.icon} style={{ fontSize: 16, marginTop: 1 }} aria-hidden />
      <Box sx={{ color: 'text.primary', minWidth: 0 }}>
        <Box component='span' sx={{ fontWeight: 700 }}>{pool.name}</Box>
        <Box component='span' sx={{ ...TABULAR, color: 'text.secondary' }}> ({t('pools.protection', { size: pool.size, min: pool.minSize })})</Box>
        {t('ui.separator')}
        {toleranceText(t, domain, tol)}
      </Box>
    </Box>
  )
}

export function poolsOfRule(pools: Pool[], rule: CrushRule): Pool[] {
  return pools.filter(p => (p.crushRuleName ? p.crushRuleName === rule.name : p.crushRule === rule.id))
}

export default function CrushRules({ rules, buckets, pools, onPool }: {
  rules: CrushRule[]
  buckets: CrushBucket[]
  pools: Pool[]
  onPool: (name: string) => void
}) {
  const t = useTranslations('cephCockpit')

  if (rules.length === 0) return <Typography sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>{t('crush.rules.empty')}</Typography>

  return (
    <Box data-testid='crush-rules'>
      {rules.map((rule, i) => {
        const used = poolsOfRule(pools, rule)
        const { deviceClass } = ruleFailureDomain(rule)

        return (
          <Box key={rule.id} data-testid='crush-rule' data-rule={rule.name} sx={{ py: 1.5, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <i className='ri-route-line' style={{ fontSize: 16, opacity: 0.6 }} aria-hidden />
              <Typography component='span' sx={{ fontSize: 13, fontWeight: 700 }}>{rule.name}</Typography>
              <Tag>{t(`crush.rules.type.${rule.type}`)}</Tag>
              {deviceClass && <Tag>{t('crush.rules.class', { class: deviceClass })}</Tag>}
              <Box component='span' sx={{ flex: 1 }} />
              <Typography component='span' variant='caption' color='text.secondary' sx={{ display: 'inline-flex', alignItems: 'center', columnGap: 1, flexWrap: 'wrap' }}>
                {t('crush.rules.pools')}
                {used.length === 0 ? t('crush.rules.noPool') : used.map(p => (
                  <ButtonBase
                    key={p.name}
                    aria-label={t('crush.rules.openPool', { name: p.name })}
                    onClick={() => onPool(p.name)}
                    sx={{ fontSize: 12, fontWeight: 600, color: 'primary.main', borderRadius: 0.5, '&:hover': { textDecoration: 'underline' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}
                  >
                    {p.name}
                  </ButtonBase>
                ))}
              </Typography>
            </Box>
            <Box data-testid='crush-steps' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
              {rule.steps.map((step, k) => (
                <Box key={k} component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  {k > 0 && <i className='ri-arrow-right-line' style={{ opacity: 0.4 }} aria-hidden />}
                  <Box component='span' data-testid={`crush-step-${step.op}`} sx={{ ...TABULAR, fontSize: 12, px: 0.875, py: 0.25, borderRadius: 1, bgcolor: 'action.hover' }}>
                    <StepText step={step} />
                  </Box>
                </Box>
              ))}
            </Box>
            {used.map(p => <PoolTolerance key={p.name} pool={p} rule={rule} buckets={buckets} />)}
          </Box>
        )
      })}
    </Box>
  )
}

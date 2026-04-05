'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import type { FirewallRule, FirewallOptions, SecurityGroup, FirewallAPIAdapter, SnackbarState } from './types'
import { normalizeRules } from './shared'

const DEFAULT_NEW_RULE: Partial<FirewallRule> = {
  type: 'in',
  action: 'ACCEPT',
  enable: 1,
  proto: '',
  dport: '',
  source: '',
  dest: '',
  comment: ''
}

export function useFirewallState(api: FirewallAPIAdapter) {
  const t = useTranslations()

  // State
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' })

  // Firewall data
  const [options, setOptions] = useState<FirewallOptions>({})
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [availableGroups, setAvailableGroups] = useState<SecurityGroup[]>([])

  // Drag & drop state
  const [draggedRule, setDraggedRule] = useState<number | null>(null)
  const [dragOverRule, setDragOverRule] = useState<number | null>(null)

  // Dialogs
  const [addRuleOpen, setAddRuleOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [editRuleOpen, setEditRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [ruleToDelete, setRuleToDelete] = useState<number | null>(null)

  // Form state
  const [newRule, setNewRule] = useState<Partial<FirewallRule>>({ ...DEFAULT_NEW_RULE })
  const [selectedGroup, setSelectedGroup] = useState('')

  // Load firewall data
  const loadFirewallData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [optData, rulesData, groupsData] = await Promise.all([
        api.getOptions().catch(() => ({})),
        api.getRules().catch(() => []),
        api.getGroups().catch(() => []),
      ])

      setOptions(optData || {})
      setRules(normalizeRules(rulesData))
      setAvailableGroups(Array.isArray(groupsData) ? groupsData : [])
    } catch (err: any) {
      setError(err.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  // Load only rules (for quick refresh after move/toggle/delete)
  const loadRulesOnly = useCallback(async () => {
    try {
      const rulesData = await api.getRules()
      setRules(normalizeRules(rulesData))
    } catch (err) {
      // Silently fail, user can refresh manually
    }
  }, [api])

  // Toggle firewall enable
  const handleToggleFirewall = async () => {
    setSaving(true)

    try {
      const newEnable = options.enable === 1 ? 0 : 1

      await api.updateOptions({ enable: newEnable })
      setSnackbar({ open: true, message: `Firewall ${newEnable === 1 ? t('common.enabled') : t('common.disabled')}`, severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Change policy IN or OUT
  const handlePolicyChange = async (field: 'policy_in' | 'policy_out', value: string) => {
    setSaving(true)

    try {
      await api.updateOptions({ [field]: value })
      setOptions(prev => ({ ...prev, [field]: value }))
      setSnackbar({ open: true, message: 'Policy updated', severity: 'success' })
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Change option (generic, used for log levels, etc.)
  const handleOptionChange = async (field: string, value: any) => {
    setSaving(true)

    try {
      await api.updateOptions({ [field]: value })
      setOptions(prev => ({ ...prev, [field]: value }))
      setSnackbar({ open: true, message: `${field} updated`, severity: 'success' })
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Add rule (takes payload directly so each scope can customize before calling)
  const handleAddRule = async (payload?: any) => {
    setSaving(true)

    try {
      await api.addRule(payload || newRule)
      setSnackbar({ open: true, message: t('network.addRule'), severity: 'success' })
      setAddRuleOpen(false)
      setNewRule({ ...DEFAULT_NEW_RULE })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Add security group
  const handleAddSecurityGroup = async () => {
    if (!selectedGroup) return
    setSaving(true)

    try {
      await api.addRule({ type: 'group', action: selectedGroup, enable: 1 })
      setSnackbar({ open: true, message: t('network.addSecurityGroup'), severity: 'success' })
      setAddGroupOpen(false)
      setSelectedGroup('')
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Toggle rule enable
  const handleToggleRule = async (rule: FirewallRule) => {
    setSaving(true)

    try {
      const currentEnable = rule.enable === undefined ? 1 : (typeof rule.enable === 'string' ? Number.parseInt(rule.enable as any, 10) : rule.enable)
      const newEnable = currentEnable === 1 ? 0 : 1

      await api.updateRule(rule.pos, { enable: newEnable })
      setSnackbar({ open: true, message: `${t('network.editRule')} ${newEnable === 0 ? t('common.disabled') : t('common.enabled')}`, severity: 'success' })
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Confirm delete rule
  const confirmDeleteRule = (pos: number) => {
    setRuleToDelete(pos)
    setDeleteConfirmOpen(true)
  }

  // Delete rule
  const handleDeleteRule = async () => {
    if (ruleToDelete === null) return
    setSaving(true)
    setDeleteConfirmOpen(false)

    try {
      await api.deleteRule(ruleToDelete)
      setSnackbar({ open: true, message: t('common.delete'), severity: 'success' })
      setRuleToDelete(null)
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Move rule to new position
  const handleMoveRule = async (fromPos: number, toPos: number) => {
    if (fromPos === toPos) return
    setSaving(true)

    try {
      await api.updateRule(fromPos, { moveto: toPos })
      setSnackbar({ open: true, message: t('network.editRule'), severity: 'success' })
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, pos: number) => {
    setDraggedRule(pos)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())

    setTimeout(() => {
      const row = e.currentTarget as HTMLElement

      row.style.opacity = '0.5'
    }, 0)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    const row = e.currentTarget as HTMLElement

    row.style.opacity = '1'
    setDraggedRule(null)
    setDragOverRule(null)
  }

  const handleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (draggedRule !== null && draggedRule !== pos) {
      setDragOverRule(pos)
    }
  }

  const handleDragLeave = () => {
    setDragOverRule(null)
  }

  const handleDrop = (e: React.DragEvent, toPos: number) => {
    e.preventDefault()
    const fromPos = draggedRule

    setDraggedRule(null)
    setDragOverRule(null)

    if (fromPos !== null && fromPos !== toPos) {
      handleMoveRule(fromPos, toPos)
    }
  }

  // Update rule (takes payload directly so each scope can customize)
  const handleUpdateRule = async (payload?: any) => {
    if (!editingRule) return
    setSaving(true)

    try {
      await api.updateRule(editingRule.pos, payload || editingRule)
      setSnackbar({ open: true, message: t('network.editRule'), severity: 'success' })
      setEditRuleOpen(false)
      setEditingRule(null)
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return {
    // State
    loading,
    saving,
    error,
    snackbar,
    setSnackbar,
    options,
    setOptions,
    rules,
    availableGroups,
    setAvailableGroups,
    newRule,
    setNewRule,
    selectedGroup,
    setSelectedGroup,

    // Dialog state
    addRuleOpen,
    setAddRuleOpen,
    addGroupOpen,
    setAddGroupOpen,
    editRuleOpen,
    setEditRuleOpen,
    editingRule,
    setEditingRule,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    ruleToDelete,

    // Drag & drop state
    draggedRule,
    dragOverRule,

    // Handlers
    handleToggleFirewall,
    handleAddRule,
    handleAddSecurityGroup,
    handleToggleRule,
    confirmDeleteRule,
    handleDeleteRule,
    handleMoveRule,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleUpdateRule,
    handlePolicyChange,
    handleOptionChange,
    loadFirewallData,
    loadRulesOnly,
  }
}

'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItem, ListItemText, TextField, Tooltip, Typography
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { useToast } from '@/contexts/ToastContext'

interface SecurityGroupMembersDialogProps {
  open: boolean
  groupName: string
  connectionId: string
  /** Every guest the firewall scan covered, with its rules. */
  guests: VMFirewallInfo[]
  /** Guests the scan left out: they can be neither listed nor offered here. */
  guestsNotScanned: number
  onClose: () => void
  /** Called with the guests whose rules changed, so the caller can refresh them. */
  onChanged: (touched: VMFirewallInfo[]) => void
}

/** The group rule a guest carries for this security group, if any. */
function groupRuleOf(guest: VMFirewallInfo, groupName: string) {
  return guest.rules.find(r => r.type === 'group' && r.action === groupName)
}

/**
 * Attach a security group to guests, and detach it, from the group's own screen.
 *
 * PVE has no membership list of its own: a group applies to a guest because that
 * guest carries a rule of type `group` whose action is the group name. So the
 * members shown here are derived from the guests' rules, attaching inserts such
 * a rule, and detaching deletes it.
 */
export default function SecurityGroupMembersDialog({
  open, groupName, connectionId, guests, guestsNotScanned, onClose, onChanged
}: SecurityGroupMembersDialogProps) {
  const t = useTranslations()
  const { showToast } = useToast()

  const [selected, setSelected] = useState<VMFirewallInfo[]>([])
  const [busy, setBusy] = useState(false)

  const members = useMemo(
    () => guests.filter(g => groupRuleOf(g, groupName)),
    [guests, groupName]
  )

  const candidates = useMemo(
    () => guests.filter(g => !groupRuleOf(g, groupName)),
    [guests, groupName]
  )

  const guestLabel = (g: VMFirewallInfo) => `${g.name} (${g.vmid})`

  const attach = async () => {
    if (selected.length === 0) return

    setBusy(true)

    const done: VMFirewallInfo[] = []
    const failed: string[] = []

    // Sequential on purpose: PVE rewrites the guest's rule file on each insert,
    // and parallel inserts on the same guest list race for it.
    for (const guest of selected) {
      try {
        await firewallAPI.addVMRule(connectionId, guest.node, guest.type, guest.vmid, {
          type: 'group',
          action: groupName,
          enable: 1,
        })
        done.push(guest)
      } catch {
        failed.push(guestLabel(guest))
      }
    }

    setBusy(false)
    setSelected([])

    // Whatever succeeded stays: a partial failure is reported, not rolled back.
    if (done.length > 0) {
      onChanged(done)
      showToast(t('firewall.membersAttached', { count: done.length, group: groupName }), 'success')
    }

    if (failed.length > 0) {
      showToast(t('firewall.membersAttachFailed', { guests: failed.join(', ') }), 'error')
    }
  }

  const detach = async (guest: VMFirewallInfo) => {
    const rule = groupRuleOf(guest, groupName)

    if (!rule || rule.pos === undefined) return

    setBusy(true)

    try {
      await firewallAPI.deleteVMRule(connectionId, guest.node, guest.type, guest.vmid, rule.pos)
      onChanged([guest])
      showToast(t('firewall.membersDetached', { guest: guestLabel(guest), group: groupName }), 'success')
    } catch {
      showToast(t('firewall.membersDetachFailed', { guests: guestLabel(guest) }), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('firewall.membersTitle', { group: groupName })}</DialogTitle>
      <DialogContent>
        {guestsNotScanned > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('firewall.membersPartial', { count: guestsNotScanned })}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 2 }}>
          <Autocomplete
            multiple
            size="small"
            sx={{ flex: 1 }}
            options={candidates}
            value={selected}
            onChange={(_, value) => setSelected(value)}
            getOptionLabel={guestLabel}
            isOptionEqualToValue={(a, b) => a.vmid === b.vmid}
            renderInput={params => <TextField {...params} label={t('firewall.membersAttachLabel')} />}
          />
          <Button variant="contained" onClick={attach} disabled={busy || selected.length === 0} sx={{ mt: 0.25 }}>
            {t('firewall.membersAttach')}
          </Button>
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t('firewall.membersCurrent')}
          <Chip label={members.length} size="small" sx={{ ml: 1, height: 18, fontSize: 10 }} />
        </Typography>

        {members.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
            {t('firewall.membersEmpty')}
          </Typography>
        ) : (
          <List dense disablePadding>
            {members.map(guest => (
              <ListItem
                key={guest.vmid}
                secondaryAction={
                  <Tooltip title={t('firewall.membersDetach')}>
                    <span>
                      <IconButton aria-label={t('firewall.membersDetach')} edge="end" size="small" disabled={busy} onClick={() => detach(guest)}>
                        <i className="ri-link-unlink" style={{ fontSize: 16 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                }
              >
                <i
                  className={guest.type === 'qemu' ? 'ri-computer-line' : 'ri-instance-line'}
                  style={{ fontSize: 16, marginRight: 8, opacity: 0.7 }}
                />
                <ListItemText primary={guestLabel(guest)} secondary={guest.node} />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { postNodeOp } from '@/lib/k8s/nodeOpsClient'
import { podListPreview, type DrainResult } from '@/lib/k8s/nodeDrain'

const WARN = '#ff9800'

/**
 * Confirm + dry-run preview for a node drain. It does NOT run the drain: on
 * confirm it calls onConfirm(force) and the caller runs the drain in the
 * background (progress is shown in the Nodes table). Rendered only while open,
 * so it mounts fresh per node and previews on mount.
 */
export function NodeDrainDialog({
  clusterId, nodeName, controlPlane, lastReadyNode, onConfirm, onClose,
}: {
  clusterId: string
  nodeName: string
  controlPlane: boolean
  lastReadyNode: boolean
  onConfirm: (force: boolean) => void
  onClose: () => void
}) {
  const t = useTranslations('kubernetes.node.ops')
  const [previewing, setPreviewing] = useState(true)
  const [preview, setPreview] = useState<DrainResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [force, setForce] = useState(false)
  const seqRef = useRef(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // Dry-run preview for a given force value. seqRef guards against a slower
  // earlier request (rapid Force toggle) overwriting the latest counts.
  const runPreview = useCallback((forceVal: boolean) => {
    const seq = ++seqRef.current
    const fresh = () => aliveRef.current && seq === seqRef.current
    setPreview(null)
    setPreviewError(null)
    setPreviewing(true)
    postNodeOp(clusterId, nodeName, 'drain', { dryRun: true, force: forceVal })
      .then((data) => { if (fresh()) setPreview(data as DrainResult) })
      .catch((err) => { if (fresh()) setPreviewError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (fresh()) setPreviewing(false) })
  }, [clusterId, nodeName])

  useEffect(() => { runPreview(false) }, [runPreview])

  const previewRefused = preview ? [...preview.refusedEmptyDir, ...preview.refusedUnmanaged] : []

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('confirmDrainTitle', { node: nodeName })}</DialogTitle>
      <DialogContent>
        {(controlPlane || lastReadyNode) && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {controlPlane && <Typography variant="body2">{t('controlPlaneWarning')}</Typography>}
            {lastReadyNode && <Typography variant="body2">{t('lastNodeWarning')}</Typography>}
          </Alert>
        )}

        {previewing && <LinearProgress sx={{ mb: 1 }} />}
        {previewError && <Alert severity="warning" sx={{ mb: 1 }}>{previewError}</Alert>}
        {preview && (
          <Box sx={{ mb: 1 }}>
            <Typography variant="body2">{t('willEvict', { count: preview.remaining.length })}</Typography>
            <Typography variant="body2">{t('willSkip', { count: preview.skipped })}</Typography>
            {previewRefused.length > 0 && (
              <>
                <Typography variant="body2" sx={{ color: WARN }}>
                  {t('willRefuse', { count: previewRefused.length })}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.75, wordBreak: 'break-word' }}>
                  {podListPreview(previewRefused)}
                </Typography>
              </>
            )}
          </Box>
        )}

        <FormControlLabel
          control={(
            <Checkbox
              checked={force}
              onChange={(e) => { const next = e.target.checked; setForce(next); runPreview(next) }}
            />
          )}
          label={t('forceLabel')}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" color="warning" disabled={previewing} onClick={() => onConfirm(force)}>
          {t('confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

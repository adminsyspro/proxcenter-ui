'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import {
  Divider,
  IconButton,
  Stack,
  Tooltip as MuiTooltip,
} from '@mui/material'

const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ContentCopyIcon = (props: any) => <i className="ri-file-copy-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DescriptionIcon = (props: any) => <i className="ri-file-text-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

function VmActions({
  disabled,
  vmStatus,
  isCluster,
  isLocked,
  lockType,
  onStart,
  onShutdown,
  onStop,
  onPause,
  onMigrate,
  onClone,
  onConvertTemplate,
  onDelete,
  onUnlock,
}: {
  disabled?: boolean
  vmStatus?: string
  isCluster?: boolean
  isLocked?: boolean
  lockType?: string
  onStart: () => void
  onShutdown: () => void
  onStop: () => void
  onPause: () => void
  onMigrate: () => void
  onClone: () => void
  onConvertTemplate: () => void
  onDelete: () => void
  onUnlock?: () => void
}) {
  const t = useTranslations()
  const isRunning = vmStatus === 'running'
  const isStopped = vmStatus === 'stopped' || vmStatus === 'unknown'

  return (
    <Stack direction="row" spacing={0.25} alignItems="center" sx={{ ml: 'auto' }}>
      {/* Start */}
      <MuiTooltip title={t('audit.actions.start')}>
        <span>
          <IconButton
            size="small"
            onClick={onStart}
            disabled={disabled || isRunning}
            sx={{ color: '#2e7d32', '&:hover': { bgcolor: 'rgba(46,125,50,0.12)' } }}
          >
            <PlayArrowIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Shutdown */}
      <MuiTooltip title={t('inventoryPage.shutdownClean')}>
        <span>
          <IconButton
            size="small"
            onClick={onShutdown}
            disabled={disabled || !isRunning}
            sx={{ color: '#f59e0b', '&:hover': { bgcolor: 'rgba(245,158,11,0.12)' } }}
          >
            <PowerSettingsNewIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Stop */}
      <MuiTooltip title={t('audit.actions.stop')}>
        <span>
          <IconButton
            size="small"
            onClick={onStop}
            disabled={disabled || !isRunning}
            sx={{ color: '#c62828', '&:hover': { bgcolor: 'rgba(198,40,40,0.12)' } }}
          >
            <StopIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Pause */}
      <MuiTooltip title={t('audit.actions.suspend')}>
        <span>
          <IconButton
            size="small"
            onClick={onPause}
            disabled={disabled || !isRunning}
            sx={{ color: '#1976d2', '&:hover': { bgcolor: 'rgba(25,118,210,0.12)' } }}
          >
            <PauseIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Migrate - toujours visible (cross-cluster disponible même pour standalone) */}
      <MuiTooltip title={t('audit.actions.migrate')}>
        <span>
          <IconButton
            size="small"
            onClick={onMigrate}
            disabled={disabled}
            sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <MoveUpIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Clone */}
      <MuiTooltip title={t('audit.actions.clone')}>
        <span>
          <IconButton
            size="small"
            onClick={onClone}
            disabled={disabled}
            sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Convert to Template */}
      <MuiTooltip title={t('templates.fromVm')}>
        <span>
          <IconButton
            size="small"
            onClick={onConvertTemplate}
            disabled={disabled || isRunning}
            sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <DescriptionIcon fontSize="small" />
          </IconButton>
        </span>
      </MuiTooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Delete VM */}
      <MuiTooltip title={isRunning ? t('inventory.vmRunningWarning') : t('inventory.deleteVm')}>
        <span>
          <IconButton
            size="small"
            onClick={onDelete}
            disabled={disabled || isRunning}
            sx={{ 
              color: isRunning ? 'text.disabled' : 'error.main', 
              '&:hover': { bgcolor: 'rgba(244,67,54,0.12)' } 
            }}
          >
            <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Unlock - Only shown when VM is locked */}
      {isLocked && onUnlock && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <MuiTooltip title={`${t('inventory.unlock')} (${lockType || 'locked'})`}>
            <span>
              <IconButton
                size="small"
                onClick={onUnlock}
                disabled={disabled}
                sx={{ 
                  color: '#f59e0b',
                  '&:hover': { bgcolor: 'rgba(245,158,11,0.12)' } 
                }}
              >
                <i className="ri-lock-unlock-line" style={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </MuiTooltip>
        </>
      )}
    </Stack>
  )
}


export default VmActions

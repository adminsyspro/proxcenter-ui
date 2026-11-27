import { describe, it, expect } from 'vitest'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import de from '@/messages/de.json'
import zh from '@/messages/zh-CN.json'
import es from '@/messages/es.json'
import ko from '@/messages/ko.json'

const required = [
  'kubernetes.history.action.cordon', 'kubernetes.history.action.create', 'kubernetes.history.action.delete', 'kubernetes.history.action.drain', 'kubernetes.history.action.restart', 'kubernetes.history.action.rollback', 'kubernetes.history.action.scale', 'kubernetes.history.action.uncordon', 'kubernetes.history.action.update', 'kubernetes.history.by', 'kubernetes.history.empty', 'kubernetes.history.error', 'kubernetes.history.failed', 'kubernetes.history.filter.action', 'kubernetes.history.filter.all', 'kubernetes.history.filter.event', 'kubernetes.history.filter.rollout', 'kubernetes.history.partial', 'kubernetes.history.retention', 'kubernetes.history.rollout', 'kubernetes.history.rolloutRestart', 'kubernetes.history.rolloutConfig', 'kubernetes.history.title', 'kubernetes.history.warningsOnly',
  'kubernetes.explorer.compareWith', 'kubernetes.compare.title', 'kubernetes.compare.with', 'kubernetes.compare.onlyChanges', 'kubernetes.compare.noOther', 'kubernetes.compare.error', 'kubernetes.compare.identical', 'kubernetes.compare.changes', 'kubernetes.compare.truncated', 'kubernetes.compare.close',
  'kubernetes.issues.counts', 'kubernetes.issues.empty', 'kubernetes.issues.loading', 'kubernetes.issues.reason.configError', 'kubernetes.issues.reason.crashLoop', 'kubernetes.issues.reason.evicted', 'kubernetes.issues.reason.imagePull', 'kubernetes.issues.reason.jobFailed', 'kubernetes.issues.reason.nodeCordoned', 'kubernetes.issues.reason.nodeNotReady', 'kubernetes.issues.reason.nodePressure', 'kubernetes.issues.reason.oomKilled', 'kubernetes.issues.reason.pending', 'kubernetes.issues.reason.podFailed', 'kubernetes.issues.reason.pvcPending', 'kubernetes.issues.reason.restarting', 'kubernetes.issues.reason.unschedulable', 'kubernetes.issues.reason.workloadDegraded', 'kubernetes.issues.reason.workloadDown', 'kubernetes.issues.severity.critical', 'kubernetes.issues.severity.warning', 'kubernetes.issues.title',
  'kubernetes.workload.action.delete', 'kubernetes.workload.action.restart', 'kubernetes.workload.action.rollback', 'kubernetes.workload.action.scale', 'kubernetes.workload.body.delete', 'kubernetes.workload.body.restart', 'kubernetes.workload.cancel', 'kubernetes.workload.current', 'kubernetes.workload.currentReplicas', 'kubernetes.workload.done.delete', 'kubernetes.workload.done.restart', 'kubernetes.workload.done.rollback', 'kubernetes.workload.done.scale', 'kubernetes.workload.error.auth_failed', 'kubernetes.workload.error.conflict', 'kubernetes.workload.error.forbidden', 'kubernetes.workload.error.generic', 'kubernetes.workload.error.not_found', 'kubernetes.workload.error.unreachable', 'kubernetes.workload.noRevision', 'kubernetes.workload.replicas', 'kubernetes.workload.revision', 'kubernetes.workload.title.delete', 'kubernetes.workload.title.restart', 'kubernetes.workload.title.rollback', 'kubernetes.workload.title.scale',
  'kubernetes.sectionTitle', 'kubernetes.addCluster',
  'kubernetes.importCluster', 'kubernetes.empty',
  'kubernetes.health.healthy', 'kubernetes.health.degraded',
  'kubernetes.health.unreachable', 'kubernetes.health.auth_failed',
  'kubernetes.health.stale', 'kubernetes.health.unknown',
  'kubernetes.health.integrating', 'kubernetes.health.checking',
  'kubernetes.health.recheck', 'kubernetes.health.lastChecked',
  'kubernetes.importDialog.title', 'kubernetes.importDialog.pasteLabel',
  'kubernetes.importDialog.contextLabel', 'kubernetes.importDialog.nameLabel',
  'kubernetes.importDialog.leastPrivilegeHint', 'kubernetes.delete.confirm',
  'kubernetes.explorer.charts.phaseTitle', 'kubernetes.explorer.charts.perNodeTitle',
  'kubernetes.explorer.charts.unscheduled', 'kubernetes.explorer.charts.moreNodes',
  'kubernetes.explorer.charts.restartsTitle', 'kubernetes.explorer.charts.noRestarts',
  'kubernetes.explorer.charts.warningsTitle', 'kubernetes.explorer.charts.noWarnings',
  'kubernetes.explorer.charts.forbidden', 'kubernetes.explorer.charts.incomplete',
  'kubernetes.explorer.charts.noPods', 'kubernetes.explorer.charts.utilizationTitle',
  'kubernetes.explorer.charts.clusterCpu', 'kubernetes.explorer.charts.clusterMemory',
  'kubernetes.explorer.charts.perNode', 'kubernetes.explorer.charts.metricsUnavailable',
  'kubernetes.explorer.charts.metricsForbidden', 'kubernetes.explorer.charts.metricsError',
  'kubernetes.explorer.charts.nodesReporting', 'kubernetes.explorer.detail.truncated',
  'kubernetes.explorer.detail.section.info', 'kubernetes.explorer.detail.section.capacity',
  'kubernetes.explorer.detail.section.conditions', 'kubernetes.explorer.detail.section.taints',
  'kubernetes.explorer.detail.section.resources', 'kubernetes.explorer.detail.section.volumes',
  'kubernetes.explorer.detail.section.selector', 'kubernetes.explorer.detail.section.ports',
  'kubernetes.explorer.detail.section.rules', 'kubernetes.explorer.detail.section.tls',
  'kubernetes.explorer.detail.section.dataKeys', 'kubernetes.node.ops.cordon',
  'kubernetes.node.ops.uncordon', 'kubernetes.node.ops.drain',
  'kubernetes.node.ops.enterMaintenance',
  'kubernetes.node.ops.exitMaintenance', 'kubernetes.node.ops.scheduling.ready',
  'kubernetes.node.ops.scheduling.disabled', 'kubernetes.node.ops.confirmDrainTitle',
  'kubernetes.node.ops.confirmMaintenanceTitle', 'kubernetes.node.ops.confirmCordonTitle',
  'kubernetes.node.ops.confirmUncordonTitle', 'kubernetes.node.ops.willEvict',
  'kubernetes.node.ops.willSkip', 'kubernetes.node.ops.willRefuse',
  'kubernetes.node.ops.forceLabel', 'kubernetes.node.ops.draining',
  'kubernetes.node.ops.drained', 'kubernetes.node.ops.blockedByPdb',
  'kubernetes.node.ops.evictionFailed', 'kubernetes.node.ops.refusedHint',
  'kubernetes.node.ops.controlPlaneWarning', 'kubernetes.node.ops.lastNodeWarning',
  'kubernetes.node.ops.cancel', 'kubernetes.node.ops.confirm',
  'kubernetes.downloadKubeconfig',
]
function get(obj: any, path: string) { return path.split('.').reduce((o, k) => o?.[k], obj) }

describe('kubernetes i18n parity', () => {
  for (const locale of [['en', en], ['fr', fr], ['de', de], ['zh-CN', zh], ['es', es], ['ko', ko]] as const) {
    for (const key of required) {
      it(`${locale[0]} has ${key}`, () => {
        const v = get(locale[1], key)
        expect(typeof v).toBe('string')
        expect(v).not.toContain(String.fromCharCode(0x2014)) // no em-dash
      })
    }
  }
})

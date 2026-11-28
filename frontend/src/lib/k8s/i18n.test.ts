import { describe, it, expect } from 'vitest'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import de from '@/messages/de.json'
import zh from '@/messages/zh-CN.json'
import es from '@/messages/es.json'
import ko from '@/messages/ko.json'

const required = [
  'kubernetes.workers.add', 'kubernetes.workers.addButton', 'kubernetes.workers.addHelp', 'kubernetes.workers.addTitle', 'kubernetes.workers.cancel', 'kubernetes.workers.changing', 'kubernetes.workers.count', 'kubernetes.workers.draining', 'kubernetes.workers.error.connection_busy', 'kubernetes.workers.error.drain', 'kubernetes.workers.error.generic', 'kubernetes.workers.error.invalid', 'kubernetes.workers.error.invalid_request', 'kubernetes.workers.error.not_a_worker', 'kubernetes.workers.error.not_cordoned', 'kubernetes.workers.error.not_deployed', 'kubernetes.workers.error.nothing_to_change', 'kubernetes.workers.error.run_not_changeable', 'kubernetes.workers.error.too_many', 'kubernetes.workers.error.unavailable', 'kubernetes.workers.error.vm_not_node', 'kubernetes.workers.error.workers_not_changeable', 'kubernetes.workers.failed', 'kubernetes.workers.ip', 'kubernetes.workers.remove', 'kubernetes.workers.removeAction', 'kubernetes.workers.removeText', 'kubernetes.workers.removeTitle', 'kubernetes.workers.removeWarning', 'kubernetes.workers.removing', 'kubernetes.workers.sizeCores', 'kubernetes.workers.sizeDisk', 'kubernetes.workers.sizeMemory', 'kubernetes.workers.vmid',
  'kubernetes.provision.progress.integrated',
  'kubernetes.delete.destroyRefused',
  'kubernetes.provision.error.cluster_name_taken', 'kubernetes.provision.progress.nameTaken',
  'kubernetes.provision.review.vms', 'kubernetes.provision.distro.rke2Cni',
  'kubernetes.provision.validation.snippetRequired', 'kubernetes.provision.validation.osImageUrlRequired', 'kubernetes.provision.validation.osImageChecksumRequired', 'kubernetes.provision.validation.osImageChecksumFormat', 'kubernetes.provision.validation.clusterNameRequired', 'kubernetes.provision.validation.connectionRequired', 'kubernetes.provision.validation.nodeRequired', 'kubernetes.provision.validation.imageDatastoreRequired', 'kubernetes.provision.validation.vmDatastoreRequired', 'kubernetes.provision.validation.bridgeRequired', 'kubernetes.provision.validation.gatewayRequired', 'kubernetes.provision.validation.dnsRequired', 'kubernetes.provision.validation.talosVersionRequired', 'kubernetes.provision.validation.kubernetesVersionRequired', 'kubernetes.provision.validation.schematicRequired', 'kubernetes.provision.validation.k3sVersionRequired', 'kubernetes.provision.validation.rke2VersionRequired', 'kubernetes.provision.validation.kubernetesVersionPrefix', 'kubernetes.provision.validation.cniInvalid', 'kubernetes.provision.validation.vipRequired', 'kubernetes.provision.validation.vipInvalid', 'kubernetes.provision.validation.distroRequired', 'kubernetes.provision.validation.controlPlaneRequired', 'kubernetes.provision.validation.controlPlaneCount', 'kubernetes.provision.validation.controlPlaneCores', 'kubernetes.provision.validation.controlPlaneMemory', 'kubernetes.provision.validation.controlPlaneDisk', 'kubernetes.provision.validation.workerCores', 'kubernetes.provision.validation.workerMemory', 'kubernetes.provision.validation.workerDisk', 'kubernetes.provision.validation.rangesOverlap', 'kubernetes.provision.validation.nodeIpMissing', 'kubernetes.provision.validation.nodeIpInvalid', 'kubernetes.provision.validation.nodeIpGateway', 'kubernetes.provision.validation.nodeIpDuplicate', 'kubernetes.provision.validation.vmidDuplicate', 'kubernetes.provision.validation.vipGateway', 'kubernetes.provision.validation.vipNodeIp', 'kubernetes.provision.validation.clusterNameFormat', 'kubernetes.provision.validation.podCidrInvalid', 'kubernetes.provision.validation.serviceCidrInvalid', 'kubernetes.provision.validation.podCidrOverlapNodes', 'kubernetes.provision.validation.serviceCidrOverlapNodes',
  'kubernetes.provision.deployButton', 'kubernetes.provision.distro.cni', 'kubernetes.provision.distro.cniSelect', 'kubernetes.provision.distro.k3s', 'kubernetes.provision.distro.k3sDesc', 'kubernetes.provision.distro.k3sHaNote', 'kubernetes.provision.distro.k3sVersion', 'kubernetes.provision.distro.kubeadm', 'kubernetes.provision.distro.kubeadmChip', 'kubernetes.provision.distro.kubeadmDesc', 'kubernetes.provision.distro.kubeadmHaNote', 'kubernetes.provision.distro.kubeadmVersion', 'kubernetes.provision.distro.kubernetesVersion', 'kubernetes.provision.distro.noSnippetDatastore', 'kubernetes.provision.distro.osImageChecksum', 'kubernetes.provision.distro.osImageUrl', 'kubernetes.provision.distro.podCidr', 'kubernetes.provision.distro.rke2', 'kubernetes.provision.distro.rke2Desc', 'kubernetes.provision.distro.rke2HaNote', 'kubernetes.provision.distro.rke2Version', 'kubernetes.provision.distro.select', 'kubernetes.provision.distro.snippetDatastore', 'kubernetes.provision.distro.snippetDatastoreHelp', 'kubernetes.provision.distro.talos', 'kubernetes.provision.distro.talosDesc', 'kubernetes.provision.distro.talosVersion', 'kubernetes.provision.error.CONNECTION_LICENSE_EXCLUDED', 'kubernetes.provision.error.cidrInvalid', 'kubernetes.provision.error.cidrOverlapEach', 'kubernetes.provision.error.cidrOverlapNodes', 'kubernetes.provision.error.cluster_name_active', 'kubernetes.provision.error.connection_busy', 'kubernetes.provision.error.generic', 'kubernetes.provision.error.invalid_request', 'kubernetes.provision.error.ssh_access_required', 'kubernetes.provision.error.unavailable', 'kubernetes.provision.network.cidrHelp', 'kubernetes.provision.network.controlPlaneNodes', 'kubernetes.provision.network.dns', 'kubernetes.provision.network.dnsHelp', 'kubernetes.provision.network.gateway', 'kubernetes.provision.network.ip', 'kubernetes.provision.network.podCidr', 'kubernetes.provision.network.serviceCidr', 'kubernetes.provision.network.subnetPrefix', 'kubernetes.provision.network.vip', 'kubernetes.provision.network.vipHelp', 'kubernetes.provision.network.vmid', 'kubernetes.provision.network.workerNodes', 'kubernetes.provision.progress.downloadKubeconfig', 'kubernetes.provision.progress.failedTitle', 'kubernetes.provision.progress.hideLogs', 'kubernetes.provision.progress.noRun', 'kubernetes.provision.progress.openCluster', 'kubernetes.provision.progress.phase.applying', 'kubernetes.provision.progress.phase.bootstrapping', 'kubernetes.provision.progress.phase.failed', 'kubernetes.provision.progress.phase.initializing', 'kubernetes.provision.progress.phase.queued', 'kubernetes.provision.progress.phase.ready', 'kubernetes.provision.progress.registerFailed', 'kubernetes.provision.progress.registered', 'kubernetes.provision.progress.registering', 'kubernetes.provision.progress.showLogs', 'kubernetes.provision.progress.steps.apply', 'kubernetes.provision.progress.steps.bootstrap', 'kubernetes.provision.progress.steps.init', 'kubernetes.provision.progress.steps.ready', 'kubernetes.provision.progress.steps.register', 'kubernetes.provision.progress.waitingForLogs', 'kubernetes.provision.review.deployFailed', 'kubernetes.provision.review.deployNow', 'kubernetes.provision.review.summary', 'kubernetes.provision.review.nodes', 'kubernetes.provision.steps.distro', 'kubernetes.provision.steps.network', 'kubernetes.provision.steps.progress', 'kubernetes.provision.steps.review', 'kubernetes.provision.steps.target', 'kubernetes.provision.steps.topology', 'kubernetes.provision.target.bridge', 'kubernetes.provision.target.clusterName', 'kubernetes.provision.target.clusterNameHelp', 'kubernetes.provision.target.connection', 'kubernetes.provision.target.imageDatastore', 'kubernetes.provision.target.noBridges', 'kubernetes.provision.target.noImageDatastore', 'kubernetes.provision.target.noVmDatastore', 'kubernetes.provision.target.node', 'kubernetes.provision.target.vlan', 'kubernetes.provision.target.vlanPlaceholder', 'kubernetes.provision.target.vmDatastore', 'kubernetes.provision.title', 'kubernetes.provision.topology.cores', 'kubernetes.provision.topology.cpCount', 'kubernetes.provision.topology.cpSizing', 'kubernetes.provision.topology.disk', 'kubernetes.provision.topology.memory', 'kubernetes.provision.topology.workerCount', 'kubernetes.provision.topology.workerSizing',
  'kubernetes.delete.destroyNodes', 'kubernetes.delete.destroyNodesWarn', 'kubernetes.delete.destroyFailed',
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

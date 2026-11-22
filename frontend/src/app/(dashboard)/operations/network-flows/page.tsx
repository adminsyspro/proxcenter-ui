import { redirect } from 'next/navigation'

/**
 * The network flows page is gone: the sFlow volumes are in the Dashboard of Network Security (and on the
 * micro-segmentation map), where an old link or bookmark lands. The sFlow agents are in Settings > sFlow.
 */
export default function NetworkFlowsPage() {
  redirect('/automation/network?tab=dashboard')
}

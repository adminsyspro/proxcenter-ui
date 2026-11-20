import { redirect } from 'next/navigation'

/** The network flows are a tab of Network Security now: an old link or bookmark lands on it. */
export default function NetworkFlowsPage() {
  redirect('/automation/network?tab=flows')
}

export function getFlowStatusColor(status: string): string {
  switch (status) {
    case 'allowed': return '#4caf50'
    case 'blocked': return '#f44336'
    case 'partial': return '#ff9800'
    case 'self': return '#9e9e9e'
    default: return '#9e9e9e'
  }
}

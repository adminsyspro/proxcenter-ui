import { describe, expect, it } from 'vitest'

import { cpuPercentAfterRedistribution } from './simulationLoad'

describe('cpuPercentAfterRedistribution', () => {
  it('adds each moved vCPU at the node per-core utilisation', () => {
    // 16 cores at 50 % = 8 busy cores; 8 more vCPUs at 50 % = 4 more busy
    // cores; 12 / 16 = 75 %.
    expect(cpuPercentAfterRedistribution(50, 16, 8)).toBe(75)
  })

  it('doubles the load when the node takes as many vCPUs as it has cores', () => {
    expect(cpuPercentAfterRedistribution(30, 8, 8)).toBe(60)
  })

  it('leaves the load unchanged when nothing is added', () => {
    expect(cpuPercentAfterRedistribution(42, 32, 0)).toBe(42)
  })

  it('shows an overload above 100 % but caps it at 150 %', () => {
    expect(cpuPercentAfterRedistribution(80, 8, 4)).toBe(120)
    expect(cpuPercentAfterRedistribution(90, 4, 40)).toBe(150)
  })

  it('keeps the current figure for a node without a core count', () => {
    expect(cpuPercentAfterRedistribution(37, 0, 8)).toBe(37)
  })
})

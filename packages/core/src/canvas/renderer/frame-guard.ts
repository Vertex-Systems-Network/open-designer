/**
 * Tracks renderer health across frames and applies a backoff before retrying repeated failures.
 * A WebAssembly trap disables drawing immediately because the CanvasKit heap may be corrupted.
 */
export type RenderHealth = 'healthy' | 'degraded' | 'disabled'

export interface RenderHealthReport {
  health: RenderHealth
  error: string | null
}

export interface FrameGuardPolicy {
  degradeAfter: number
  disableAfter: number
  maxBackoffFrames: number
  recoverAfter: number
}

export const DEFAULT_FRAME_GUARD_POLICY: FrameGuardPolicy = {
  degradeAfter: 2,
  disableAfter: 8,
  maxBackoffFrames: 60,
  recoverAfter: 30
}

const HEALTH_RANK: Record<RenderHealth, number> = { healthy: 0, degraded: 1, disabled: 2 }

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

function isWasmTrap(error: unknown): boolean {
  return error instanceof WebAssembly.RuntimeError
}

export class FrameGuard {
  health: RenderHealth = 'healthy'
  consecutiveFailures = 0
  lastError: string | null = null
  private backoffFrames = 0
  private cleanFrames = 0

  constructor(readonly policy: FrameGuardPolicy = DEFAULT_FRAME_GUARD_POLICY) {}

  shouldDraw(): boolean {
    if (this.health === 'disabled') return false
    if (this.backoffFrames === 0) return true
    this.backoffFrames--
    return false
  }

  get retryPending(): boolean {
    return this.health !== 'disabled' && this.consecutiveFailures > 0
  }

  succeed(): boolean {
    this.consecutiveFailures = 0
    this.backoffFrames = 0
    if (this.health !== 'degraded') return false
    this.cleanFrames++
    if (this.cleanFrames < this.policy.recoverAfter) return false
    this.health = 'healthy'
    this.lastError = null
    this.cleanFrames = 0
    return true
  }

  fail(error: unknown): boolean {
    this.consecutiveFailures++
    this.cleanFrames = 0
    this.lastError = describeError(error)
    this.backoffFrames = Math.min(2 ** this.consecutiveFailures, this.policy.maxBackoffFrames)
    if (isWasmTrap(error) || this.consecutiveFailures >= this.policy.disableAfter)
      return this.escalate('disabled')
    if (this.consecutiveFailures >= this.policy.degradeAfter) return this.escalate('degraded')
    return false
  }

  disable(error: unknown): boolean {
    this.lastError = describeError(error)
    return this.escalate('disabled')
  }

  reset(): boolean {
    const changed = this.health !== 'healthy'
    this.health = 'healthy'
    this.consecutiveFailures = 0
    this.lastError = null
    this.backoffFrames = 0
    this.cleanFrames = 0
    return changed
  }

  report(): RenderHealthReport {
    return { health: this.health, error: this.health === 'healthy' ? null : this.lastError }
  }

  private escalate(health: RenderHealth): boolean {
    if (HEALTH_RANK[health] <= HEALTH_RANK[this.health]) return false
    this.health = health
    return true
  }
}

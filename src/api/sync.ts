import type { BatchSnapshot } from '../domain/types'

// 简单稳定摘要：同一批次快照同一摘要，用作写入幂等与审计去重键
export function snapshotDigest(snapshot: BatchSnapshot): string {
  const canonical = JSON.stringify({
    devices: snapshot.devices.map((device) => [device.id, device.zone, device.floor]).sort(),
    rules: snapshot.rules.map((rule) => [
      rule.id,
      rule.triggerId,
      rule.actionId,
      rule.delay,
      rule.interlock,
      rule.priority,
      rule.suppression,
      rule.enabled,
    ]),
    pathsVersion: snapshot.pathsVersion,
  })
  // FNV-1a
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `SNAP-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export type ServerCommit = {
  ticketId: string
  digest: string
  snapshot: BatchSnapshot
  committedAt: string
}

export type CommitResult = { ok: true; commit: ServerCommit } | { ok: false; error: string }

// 模拟服务器：支持注入"写入失败"故障；服务端按现场单号 + 摘要幂等落库，
// 故障期间同一单号的重试不会产生重复落库。
class SyncService {
  mode: 'online' | 'fail' = 'online'
  private commits = new Map<string, ServerCommit>()

  setMode(mode: 'online' | 'fail') {
    this.mode = mode
  }

  getCommit(ticketId: string): ServerCommit | undefined {
    return this.commits.get(ticketId)
  }

  private delay(ms = 240) {
    return new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, ms)
    })
  }

  async commit(ticketId: string, snapshot: BatchSnapshot): Promise<CommitResult> {
    await this.delay()
    if (this.mode === 'fail') {
      return { ok: false, error: '链路中断：写入未到达服务器（模拟故障）' }
    }
    const digest = snapshotDigest(snapshot)
    const existing = this.commits.get(ticketId)
    if (existing && existing.digest === digest) {
      return { ok: true, commit: existing }
    }
    const commit: ServerCommit = { ticketId, digest, snapshot, committedAt: new Date().toISOString() }
    this.commits.set(ticketId, commit)
    return { ok: true, commit }
  }
}

export const syncService = new SyncService()

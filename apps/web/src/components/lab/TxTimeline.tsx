import type { CSSProperties } from 'react'
import type { TxTrace } from '~/queries/types'
import { OUTCOME_INFO } from './modeInfo'

/**
 * 各トランザクションを横棒で描画する。
 *   薄い縞模様 = BEGIN 〜 SELECT が返るまで（ロック待ち）
 *   色付きの帯 = ロック取得 〜 COMMIT/ROLLBACK（ロック保持）
 *   縦線       = UPDATE が返った時刻
 */
export function TxTimeline({ traces, totalMs }: { traces: TxTrace[]; totalMs: number }) {
  const scale = Math.max(totalMs, 1)
  const pct = (ms: number) => `${(ms / scale) * 100}%`
  const sorted = [...traces].sort((a, b) => (a.acquiredAt ?? a.finishedAt) - (b.acquiredAt ?? b.finishedAt))

  return (
    <div className="tx-timeline">
      <div className="tx-timeline-axis">
        <span>0ms</span>
        <span>{Math.round(scale / 2)}ms</span>
        <span>{scale}ms</span>
      </div>
      {sorted.map((t) => {
        const acquired = t.acquiredAt ?? t.finishedAt
        const color = `var(--mantine-color-${OUTCOME_INFO[t.outcome].color}-6)`
        return (
          <div key={t.user} className="tx-row">
            <div className="tx-row-label">
              <span className="tx-row-user">{t.user.replace('demo-user-', '利用者')}</span>
              <span className="tx-row-pid">pid {t.pid ?? '-'}</span>
            </div>
            <div className="tx-track">
              <div
                className="tx-bar-wait"
                style={{ left: pct(t.startedAt), width: pct(acquired - t.startedAt) }}
                title={`ロック待ち ${acquired - t.startedAt}ms`}
              />
              {t.acquiredAt !== null && (
                <div
                  className="tx-bar-hold"
                  style={{ left: pct(t.acquiredAt), width: pct(t.finishedAt - t.acquiredAt), '--bar-color': color } as CSSProperties}
                  title={`ロック保持 ${t.finishedAt - t.acquiredAt}ms`}
                />
              )}
              {t.writtenAt !== null && <div className="tx-mark-write" style={{ left: pct(t.writtenAt) }} title="UPDATE 完了" />}
              <div className="tx-end-dot" style={{ left: pct(t.finishedAt), '--bar-color': color } as CSSProperties} />
            </div>
          </div>
        )
      })}
      <div className="tx-legend">
        <span className="tx-legend-item">
          <i className="tx-legend-swatch tx-legend-wait" />
          ロック待ち（SELECT がブロック中）
        </span>
        <span className="tx-legend-item">
          <i className="tx-legend-swatch tx-legend-hold" />
          ロック保持〜COMMIT
        </span>
        <span className="tx-legend-item">
          <i className="tx-legend-swatch tx-legend-write" />
          UPDATE 完了
        </span>
      </div>
    </div>
  )
}

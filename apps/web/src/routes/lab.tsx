import { Alert, Badge, Button, Card, Code, NumberInput, SegmentedControl, Select, Slider, Table } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { MODE_INFO, OUTCOME_INFO } from '~/components/lab/modeInfo'
import { TxTimeline } from '~/components/lab/TxTimeline'
import { ApiError, api } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { eventKeys, eventsQuery } from '~/queries/events'
import { activeTxQuery, useLabAction, useSimulate } from '~/queries/lab'
import { myReservationsKey } from '~/queries/reservations'
import type { ActiveTx, LockMode, SimulationResult } from '~/queries/types'

export const Route = createFileRoute('/lab')({
  loader: ({ context }) => context.queryClient.query(eventsQuery()),
  component: LabPage,
})

const MODES = Object.keys(MODE_INFO) as LockMode[]

function LabPage() {
  const { data: events } = useSuspenseQuery(eventsQuery())
  const inventoryOptions = events.flatMap((e) =>
    e.inventories.map((i) => ({ value: i.id, label: `${e.title} / ${i.ticketTypeName}（定員${i.totalCapacity}）` })),
  )
  const labInventory = events.flatMap((e) => e.inventories).find((i) => i.ticketTypeName === '実験用')

  const [inventoryId, setInventoryId] = useState(labInventory?.id ?? inventoryOptions[0]?.value ?? '')
  const [mode, setMode] = useState<LockMode>('no-lock')
  const [users, setUsers] = useState(5)
  const [quantity, setQuantity] = useState(1)
  const [initialSeats, setInitialSeats] = useState(10)
  const [holdMs, setHoldMs] = useState(500)

  const simulate = useSimulate()
  const locks = useQuery(activeTxQuery(simulate.isPending))
  const info = MODE_INFO[mode]

  const run = () =>
    simulate.mutate(
      { inventoryId, mode, users, quantity, initialSeats, holdMs },
      { onError: (e) => notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : String(e) }) },
    )

  return (
    <section className="lab-page">
      <div className="page-heading">
        <h1 className="page-title">🔒 ロック実験室</h1>
        <p className="page-lead">
          デモ利用者 N 人が<strong>同時に</strong>予約ボタンを押した状況を、サーバー内で N 個のトランザクションを一斉に開始して再現します。
          ロック方式を切り替えて、結果の違いを見比べてみましょう。
        </p>
      </div>

      <div className="lab-layout">
        {/* ---- 設定パネル ---- */}
        <Card withBorder padding="lg" className="lab-settings">
          <h2 className="section-title">実験条件</h2>
          <div className="form-stack">
            <Select label="対象のチケット在庫" data={inventoryOptions} value={inventoryId} onChange={(v) => v && setInventoryId(v)} allowDeselect={false} />
            <div>
              <label className="field-label">ロック方式</label>
              <SegmentedControl fullWidth orientation="vertical" data={MODES.map((m) => ({ value: m, label: MODE_INFO[m].label }))} value={mode} onChange={(v) => setMode(v as LockMode)} />
            </div>
            <div>
              <label className="field-label">同時に押す人数: {users}人</label>
              <Slider min={2} max={10} step={1} value={users} onChange={setUsers} marks={[{ value: 2, label: '2' }, { value: 5, label: '5' }, { value: 10, label: '10' }]} />
            </div>
            <div className="form-row-2">
              <NumberInput label="初期残席" min={0} max={100} value={initialSeats} onChange={(v) => setInitialSeats(Number(v) || 0)} />
              <NumberInput label="1人あたり枚数" min={1} max={10} value={quantity} onChange={(v) => setQuantity(Number(v) || 1)} />
            </div>
            <div>
              <label className="field-label">ロック保持時間（決済処理などを想定）: {holdMs}ms</label>
              <Slider min={0} max={5000} step={100} value={holdMs} onChange={setHoldMs} marks={[{ value: 3000, label: 'lock_timeout' }]} />
            </div>
            <Button size="md" onClick={run} loading={simulate.isPending} fullWidth mt="sm">
              {users}人で同時に予約する
            </Button>
            <p className="hint-text">実行前に、デモ利用者の予約を削除して残席を「初期残席」に戻します。</p>
          </div>
        </Card>

        {/* ---- 解説パネル ---- */}
        <Card withBorder padding="lg" className="lab-explain">
          <h2 className="section-title">
            {info.label} <span className="section-sub">のしくみ</span>
          </h2>
          <p className="explain-text">{info.summary}</p>
          <div className="code-pair">
            <div>
              <div className="code-caption">Drizzle</div>
              <Code block className="code-block">{info.drizzle}</Code>
            </div>
            <div>
              <div className="code-caption">発行される SQL</div>
              <Code block className="code-block">{info.sql}</Code>
            </div>
          </div>
          <Alert variant="light" color="indigo" mt="md" title="予想される結果">
            {info.expectation}
          </Alert>
        </Card>
      </div>

      {/* ---- ライブのロック監視 ---- */}
      <LockMonitor rows={locks.data} live={simulate.isPending} pidToUser={pidMap(simulate.data)} />

      {/* ---- 結果 ---- */}
      {simulate.data && <SimulationReport result={simulate.data} />}

      <div className="lab-layout">
        <BrowserBurst inventoryId={inventoryId} />
        <ExpireBatchPanel inventoryId={inventoryId} />
      </div>
    </section>
  )
}

function pidMap(result: SimulationResult | undefined) {
  return new Map(result?.traces.map((t) => [t.pid, t.user.replace('demo-user-', '利用者')]) ?? [])
}

function SimulationReport({ result }: { result: SimulationResult }) {
  const { summary, traces, input } = result
  const reservedCount = traces.filter((t) => t.outcome === 'reserved').length
  return (
    <Card withBorder padding="lg" className="lab-result">
      <div className="result-header">
        <h2 className="section-title">
          結果 <span className="section-sub">{MODE_INFO[input.mode].label} / {input.users}人 / 保持 {input.holdMs}ms</span>
        </h2>
        <Badge size="xl" color={summary.consistent ? 'teal' : 'red'} variant="filled">
          {summary.consistent ? '整合性 OK' : '整合性 NG（ロストアップデート）'}
        </Badge>
      </div>

      <div className="stat-grid">
        <Stat label="初期残席" value={summary.initialSeats} />
        <Stat label="予約成功" value={`${reservedCount}人 / ${summary.reservedSeats}枚`} />
        <Stat label="本来の残席" value={summary.expectedSeats} note="初期 − 予約枚数" />
        <Stat label="DB上の残席" value={summary.finalSeats} danger={!summary.consistent} />
        <Stat label="全体の所要時間" value={`${summary.totalMs}ms`} />
      </div>

      <TxTimeline traces={traces} totalMs={summary.totalMs} />

      <div className="table-scroll">
        <Table striped verticalSpacing="xs" mt="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>利用者</Table.Th>
              <Table.Th>結果</Table.Th>
              <Table.Th>読んだ残席</Table.Th>
              <Table.Th>ロック待ち</Table.Th>
              <Table.Th>保持</Table.Th>
              <Table.Th>詳細</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {traces.map((t) => (
              <Table.Tr key={t.user}>
                <Table.Td>{t.user.replace('demo-user-', '利用者')}</Table.Td>
                <Table.Td>
                  <Badge color={OUTCOME_INFO[t.outcome].color} variant="light">
                    {OUTCOME_INFO[t.outcome].label}
                  </Badge>
                </Table.Td>
                <Table.Td>{t.seenSeats ?? '-'}</Table.Td>
                <Table.Td>{(t.acquiredAt ?? t.finishedAt) - t.startedAt}ms</Table.Td>
                <Table.Td>{t.acquiredAt === null ? '-' : `${t.finishedAt - t.acquiredAt}ms`}</Table.Td>
                <Table.Td className="table-sub">{t.message}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </Card>
  )
}

function Stat({ label, value, note, danger }: { label: string; value: string | number; note?: string; danger?: boolean }) {
  return (
    <div className={danger ? 'stat-box stat-box-danger' : 'stat-box'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

function LockMonitor({ rows, live, pidToUser }: { rows: ActiveTx[] | undefined; live: boolean; pidToUser: Map<number | null, string> }) {
  return (
    <Card withBorder padding="lg" className="lock-monitor">
      <div className="result-header">
        <h2 className="section-title">
          pg_stat_activity <span className="section-sub">誰が誰を待っているか</span>
        </h2>
        <Badge color={live ? 'red' : 'gray'} variant={live ? 'filled' : 'light'}>
          {live ? '● LIVE 150ms毎' : '実行中のみ監視'}
        </Badge>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="hint-text">保持時間を 500ms 以上にして実行すると、ロック待ちのトランザクションがここに表示されます。</p>
      ) : (
        <div className="table-scroll">
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>pid</Table.Th>
                <Table.Th>状態</Table.Th>
                <Table.Th>待機イベント</Table.Th>
                <Table.Th>ブロックしている pid</Table.Th>
                <Table.Th>経過</Table.Th>
                <Table.Th>実行中の SQL</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.pid}>
                  <Table.Td>
                    {r.pid}
                    {pidToUser.get(r.pid) && <div className="table-sub">{pidToUser.get(r.pid)}</div>}
                  </Table.Td>
                  <Table.Td>{r.state}</Table.Td>
                  <Table.Td>
                    {r.wait_event_type === 'Lock' ? (
                      <Badge color="red" variant="light">
                        Lock: {r.wait_event}
                      </Badge>
                    ) : (
                      (r.wait_event ?? '-')
                    )}
                  </Table.Td>
                  <Table.Td>{r.blocked_by.length ? r.blocked_by.join(', ') : '-'}</Table.Td>
                  <Table.Td>{r.xact_ms ?? '-'}ms</Table.Td>
                  <Table.Td>
                    <code className="inline-sql">{r.query}</code>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

/** ログイン中のユーザーとして、ブラウザから本物の予約APIを N 本同時に投げる */
function BrowserBurst({ inventoryId }: { inventoryId: string }) {
  const { data: session } = authClient.useSession()
  const qc = useQueryClient()
  const [count, setCount] = useState(5)
  const [results, setResults] = useState<{ ok: boolean; text: string; ms: number }[]>([])
  const [running, setRunning] = useState(false)

  const fire = async () => {
    setRunning(true)
    const t0 = performance.now()
    const settled = await Promise.allSettled(
      Array.from({ length: count }, () =>
        api<{ id: string }>('/api/reservations', { method: 'POST', json: { inventoryId, quantity: 1 } }).then(
          () => performance.now() - t0,
        ),
      ),
    )
    setResults(
      settled.map((s) =>
        s.status === 'fulfilled'
          ? { ok: true, text: '予約成功', ms: Math.round(s.value) }
          : { ok: false, text: s.reason instanceof ApiError ? `${s.reason.code}: ${s.reason.message}` : String(s.reason), ms: Math.round(performance.now() - t0) },
      ),
    )
    setRunning(false)
    qc.invalidateQueries({ queryKey: eventKeys.all })
    qc.invalidateQueries({ queryKey: myReservationsKey })
  }

  return (
    <Card withBorder padding="lg">
      <h2 className="section-title">
        ブラウザから同時に叩く <span className="section-sub">本物の予約API</span>
      </h2>
      <p className="explain-text">
        ログイン中のあなたとして <Code>POST /api/reservations</Code> を {count} 本同時に送ります。
        行ロックで直列化された後、2本目以降は部分ユニークインデックス <Code>reservations_user_inventory_active_idx</Code> によって
        「既に予約済み (23505)」で弾かれる様子が見られます。
      </p>
      {!session ? (
        <Alert color="yellow">この実験はログインが必要です</Alert>
      ) : (
        <div className="burst-controls">
          <NumberInput aria-label="本数" min={2} max={10} value={count} onChange={(v) => setCount(Number(v) || 2)} suffix=" 本" className="quantity-input" />
          <Button onClick={fire} loading={running} variant="light">
            同時送信
          </Button>
        </div>
      )}
      {results.length > 0 && (
        <ul className="burst-results">
          {results.map((r, i) => (
            <li key={i} className={r.ok ? 'burst-ok' : 'burst-ng'}>
              #{i + 1} {r.text} <span className="table-sub">({r.ms}ms)</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** ④ 期限切れ仮押さえの解放バッチ（FOR UPDATE SKIP LOCKED） */
function ExpireBatchPanel({ inventoryId }: { inventoryId: string }) {
  const createPending = useLabAction<{ created: number }>('/api/lab/pending')
  const batch = useLabAction<{ released: number }>('/api/lab/expire-batch')

  return (
    <Card withBorder padding="lg">
      <h2 className="section-title">
        期限切れ解放バッチ <span className="section-sub">SKIP LOCKED の本来の使い方</span>
      </h2>
      <p className="explain-text">
        期限切れの仮押さえ（pending）を <Code>.for('update', {'{ skipLocked: true }'})</Code> で取得してキャンセルし、在庫を返却します。
        ユーザーが操作中でロックされている予約行は飛ばすので、バッチが予約処理を待たせません。
      </p>
      <div className="burst-controls">
        <Button
          variant="light"
          loading={createPending.isPending}
          onClick={() => createPending.mutate({ inventoryId, count: 3 }, { onSuccess: (r) => notifications.show({ message: `期限切れの仮押さえを${r.created}件作成（残席 −${r.created}）` }) })}
        >
          ① 期限切れ仮押さえを3件作る
        </Button>
        <Button
          loading={batch.isPending}
          onClick={() => batch.mutate({}, { onSuccess: (r) => notifications.show({ color: 'teal', message: `${r.released}件を解放し在庫を返却しました` }) })}
        >
          ② バッチ実行
        </Button>
      </div>
    </Card>
  )
}

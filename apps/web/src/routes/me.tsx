import { Badge, Button, Card, Table } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { formatDateTime } from '~/lib/format'
import { myReservationsQuery, useCancelReservation, useWithdraw } from '~/queries/reservations'

export const Route = createFileRoute('/me')({ ssr: false, component: MyPage })

const statusLabel = { pending: ['仮押さえ', 'yellow'], confirmed: ['予約確定', 'teal'], cancelled: ['キャンセル済', 'gray'] } as const

function MyPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const reservations = useQuery({ ...myReservationsQuery(), enabled: !!session })
  const cancel = useCancelReservation()
  const withdraw = useWithdraw()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  if (sessionPending) return null
  if (!session)
    return (
      <p className="empty-state">
        <Link to="/login" search={{ redirect: '/me' }}>
          ログイン
        </Link>
        してください
      </p>
    )

  const onCancel = (id: string) =>
    cancel.mutate(id, {
      onSuccess: (r) => notifications.show({ color: 'teal', message: `キャンセルしました（${r.restoredSeats}席を返却）` }),
      onError: (e) => notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : String(e) }),
    })

  const onWithdraw = () => {
    withdraw.mutate(undefined, {
      onSuccess: async () => {
        await authClient.signOut().catch(() => {})
        notifications.show({ message: '退会しました' })
        navigate({ to: '/' })
      },
    })
  }

  return (
    <section>
      <div className="page-heading">
        <h1 className="page-title">マイページ</h1>
        <p className="page-lead">{session.user.email}</p>
      </div>
      <Card withBorder padding="lg">
        <h2 className="section-title">予約一覧</h2>
        {reservations.data?.length === 0 ? (
          <p className="empty-state">予約はまだありません</p>
        ) : (
          <div className="table-scroll">
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>イベント</Table.Th>
                  <Table.Th>券種</Table.Th>
                  <Table.Th>枚数</Table.Th>
                  <Table.Th>状態</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {reservations.data?.map((r) => {
                  const [label, color] = statusLabel[r.status]
                  return (
                    <Table.Tr key={r.id}>
                      <Table.Td>
                        <Link to="/events/$eventId" params={{ eventId: r.eventId }}>
                          {r.eventTitle}
                        </Link>
                        <div className="table-sub">{formatDateTime(r.startsAt)}</div>
                      </Table.Td>
                      <Table.Td>{r.ticketTypeName}</Table.Td>
                      <Table.Td>{r.quantity}枚</Table.Td>
                      <Table.Td>
                        <Badge color={color} variant="light">
                          {label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {r.status !== 'cancelled' && (
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            loading={cancel.isPending && cancel.variables === r.id}
                            onClick={() => onCancel(r.id)}
                          >
                            キャンセル
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Card>
      <div className="danger-zone">
        {confirming ? (
          <>
            <p className="hint-text">退会すると未来の予約はすべてキャンセルされ、在庫が返却されます。</p>
            <Button color="red" onClick={onWithdraw} loading={withdraw.isPending}>
              本当に退会する
            </Button>
            <Button variant="subtle" onClick={() => setConfirming(false)}>
              やめる
            </Button>
          </>
        ) : (
          <Button variant="outline" color="red" onClick={() => setConfirming(true)}>
            退会する（論理削除）
          </Button>
        )}
      </div>
    </section>
  )
}

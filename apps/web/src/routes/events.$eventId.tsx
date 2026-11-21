import { Button, Card, NumberInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { SeatMeter } from '~/components/SeatMeter'
import { ApiError } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { formatDateTime } from '~/lib/format'
import { eventQuery } from '~/queries/events'
import { useReserve } from '~/queries/reservations'
import type { Inventory } from '~/queries/types'

export const Route = createFileRoute('/events/$eventId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(eventQuery(params.eventId)),
  component: EventDetailPage,
  errorComponent: () => <p className="empty-state">イベントが見つかりません</p>,
})

function EventDetailPage() {
  const { eventId } = Route.useParams()
  const { data: event } = useSuspenseQuery(eventQuery(eventId))

  return (
    <section className="event-detail">
      <Link to="/" className="back-link">
        ← イベント一覧
      </Link>
      <div className="page-heading">
        <time className="event-date">{formatDateTime(event.startsAt)}</time>
        <h1 className="page-title">{event.title}</h1>
        <p className="page-lead">{event.description}</p>
      </div>
      <div className="ticket-list">
        {event.inventories.map((inv) => (
          <TicketRow key={inv.id} inventory={inv} />
        ))}
      </div>
    </section>
  )
}

function TicketRow({ inventory }: { inventory: Inventory }) {
  const [quantity, setQuantity] = useState(1)
  const { data: session } = authClient.useSession()
  const navigate = useNavigate()
  const reserve = useReserve()
  const soldOut = inventory.availableSeats === 0

  const onReserve = () => {
    if (!session) {
      navigate({ to: '/login', search: { redirect: location.pathname } })
      return
    }
    reserve.mutate(
      { inventoryId: inventory.id, quantity },
      {
        onSuccess: () =>
          notifications.show({ color: 'teal', title: '予約が完了しました', message: `${inventory.ticketTypeName} × ${quantity}枚` }),
        onError: (e) =>
          notifications.show({
            color: 'red',
            title: '予約できませんでした',
            message: e instanceof ApiError ? `${e.message}（${e.code}）` : String(e),
          }),
      },
    )
  }

  return (
    <Card withBorder padding="lg" className="ticket-row">
      <div className="ticket-row-info">
        <h2 className="ticket-row-name">{inventory.ticketTypeName}</h2>
        <SeatMeter available={inventory.availableSeats} total={inventory.totalCapacity} />
      </div>
      <div className="ticket-row-form">
        <NumberInput
          aria-label="枚数"
          value={quantity}
          onChange={(v) => setQuantity(Number(v) || 1)}
          min={1}
          max={Math.max(1, Math.min(10, inventory.availableSeats))}
          disabled={soldOut}
          className="quantity-input"
          suffix=" 枚"
        />
        <Button onClick={onReserve} loading={reserve.isPending} disabled={soldOut}>
          {soldOut ? '売り切れ' : '予約する'}
        </Button>
      </div>
    </Card>
  )
}

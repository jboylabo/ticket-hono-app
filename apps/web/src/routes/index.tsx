import { Badge, Card } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { SeatMeter } from '~/components/SeatMeter'
import { formatDateTime } from '~/lib/format'
import { eventsQuery } from '~/queries/events'

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery()),
  component: EventListPage,
})

function EventListPage() {
  const { data: events } = useSuspenseQuery(eventsQuery())
  return (
    <section>
      <div className="page-heading">
        <h1 className="page-title">開催予定のイベント</h1>
        <p className="page-lead">チケットを選んで予約できます。同時予約の挙動は「ロック実験室」で試せます。</p>
      </div>
      <div className="event-grid">
        {events.map((event) => {
          const total = event.inventories.reduce((s, i) => s + i.totalCapacity, 0)
          const available = event.inventories.reduce((s, i) => s + i.availableSeats, 0)
          return (
            <Card key={event.id} withBorder padding="lg" className="event-card">
              <div className="event-card-body">
                <time className="event-date">{formatDateTime(event.startsAt)}</time>
                <h2 className="event-title">{event.title}</h2>
                <p className="event-description">{event.description}</p>
                <div className="ticket-type-list">
                  {event.inventories.map((inv) => (
                    <Badge key={inv.id} variant="light" color={inv.availableSeats === 0 ? 'gray' : 'indigo'}>
                      {inv.ticketTypeName}
                    </Badge>
                  ))}
                </div>
                <SeatMeter available={available} total={total} />
              </div>
              <Link to="/events/$eventId" params={{ eventId: event.id }} className="event-card-link">
                詳細・予約へ →
              </Link>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

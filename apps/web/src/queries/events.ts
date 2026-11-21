import { queryOptions } from '@tanstack/react-query'
import { api } from '~/lib/api'
import type { EventItem } from './types'

export const eventKeys = {
  all: ['events'] as const,
  detail: (id: string) => ['events', id] as const,
}

export const eventsQuery = () =>
  queryOptions({ queryKey: eventKeys.all, queryFn: () => api<EventItem[]>('/api/events') })

export const eventQuery = (id: string) =>
  queryOptions({ queryKey: eventKeys.detail(id), queryFn: () => api<EventItem>(`/api/events/${id}`) })

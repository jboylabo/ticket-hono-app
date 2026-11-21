import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '~/lib/api'
import { eventKeys } from './events'
import type { MyReservation } from './types'

export const myReservationsKey = ['reservations', 'mine'] as const

export const myReservationsQuery = () =>
  queryOptions({ queryKey: myReservationsKey, queryFn: () => api<MyReservation[]>('/api/reservations') })

/** 予約・キャンセル後は在庫も予約一覧も古くなるのでまとめて無効化 */
function useInvalidateTickets() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: eventKeys.all }), qc.invalidateQueries({ queryKey: myReservationsKey })])
}

export function useReserve() {
  const invalidate = useInvalidateTickets()
  return useMutation({
    mutationFn: (input: { inventoryId: string; quantity: number }) =>
      api<{ id: string }>('/api/reservations', { method: 'POST', json: input }),
    onSettled: invalidate,
  })
}

export function useCancelReservation() {
  const invalidate = useInvalidateTickets()
  return useMutation({
    mutationFn: (reservationId: string) =>
      api<{ restoredSeats: number }>(`/api/reservations/${reservationId}/cancel`, { method: 'POST' }),
    onSettled: invalidate,
  })
}

export function useWithdraw() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/api/me', { method: 'DELETE' }),
    onSuccess: () => qc.clear(),
  })
}

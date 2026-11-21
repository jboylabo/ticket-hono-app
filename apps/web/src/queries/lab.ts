import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '~/lib/api'
import { eventKeys } from './events'
import type { ActiveTx, SimulationInput, SimulationResult } from './types'

export const activeTxQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ['lab', 'locks'],
    queryFn: () => api<ActiveTx[]>('/api/lab/locks'),
    enabled,
    // シミュレーション実行中だけ 150ms 間隔で pg_stat_activity を覗く
    refetchInterval: enabled ? 150 : false,
    staleTime: 0,
  })

export function useSimulate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SimulationInput) => api<SimulationResult>('/api/lab/simulate', { method: 'POST', json: input }),
    onSettled: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  })
}

export function useLabAction<T>(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<T>(path, { method: 'POST', json: body }),
    onSettled: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  })
}

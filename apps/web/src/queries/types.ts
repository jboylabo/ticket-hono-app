export type Inventory = {
  id: string
  ticketTypeName: string
  totalCapacity: number
  availableSeats: number
}

export type EventItem = {
  id: string
  title: string
  description: string | null
  startsAt: string
  inventories: Inventory[]
}

export type MyReservation = {
  id: string
  quantity: number
  status: 'pending' | 'confirmed' | 'cancelled'
  createdAt: string
  inventoryId: string
  ticketTypeName: string
  eventId: string
  eventTitle: string
  startsAt: string
}

export type LockMode = 'no-lock' | 'for-update' | 'for-update-nowait' | 'for-update-skip-locked'

export type Outcome =
  | 'reserved'
  | 'sold_out'
  | 'skipped'
  | 'lock_timeout'
  | 'lock_not_available'
  | 'check_violation'
  | 'error'

export type TxTrace = {
  user: string
  pid: number | null
  outcome: Outcome
  message: string
  seenSeats: number | null
  startedAt: number
  acquiredAt: number | null
  writtenAt: number | null
  finishedAt: number
}

export type SimulationInput = {
  inventoryId: string
  users: number
  quantity: number
  mode: LockMode
  holdMs: number
  initialSeats: number
}

export type SimulationResult = {
  input: SimulationInput
  traces: TxTrace[]
  summary: {
    initialSeats: number
    finalSeats: number
    reservedSeats: number
    expectedSeats: number
    consistent: boolean
    totalMs: number
  }
}

export type ActiveTx = {
  pid: number
  state: string
  wait_event_type: string | null
  wait_event: string | null
  blocked_by: number[]
  xact_ms: number | null
  query: string
}

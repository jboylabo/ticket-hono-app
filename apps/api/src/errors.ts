/** アプリ全体で使うドメインエラーと、PostgreSQL エラーコードの変換 */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** pg のエラーは drizzle によって cause にラップされることがあるので両方見る */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code ?? e?.cause?.code
}

export function translatePgError(err: unknown): AppError | undefined {
  switch (pgCode(err)) {
    case '55P03': // lock_not_available: lock_timeout 超過 / NOWAIT
      return new AppError(409, 'LOCK_TIMEOUT', 'アクセスが集中しています。時間をおいて再度お試しください')
    case '23514': // check_violation: available_seats >= 0 違反
      return new AppError(409, 'SOLD_OUT', '残席が不足しています')
    case '23505': // unique_violation: 部分ユニークインデックス
      return new AppError(409, 'ALREADY_RESERVED', 'このチケットは既に予約済みです')
    case '40P01': // deadlock_detected
      return new AppError(409, 'DEADLOCK', 'デッドロックが検出されました。再度お試しください')
  }
  return undefined
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiError, ApiResult } from '../api/contracts'

export type Resource<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: ApiError }
  | { readonly status: 'ready'; readonly data: T }

/**
 * Loads backend data and optionally keeps polling while `shouldPoll(data)` is true. Polling is
 * driven only by real backend state; it never simulates progress.
 */
export function useResource<T>(
  load: () => Promise<ApiResult<T>>,
  options: { shouldPoll?: (data: T) => boolean; intervalMs?: number } = {},
): { resource: Resource<T>; reload: () => void } {
  const [resource, setResource] = useState<Resource<T>>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  const pollRef = useRef(options.shouldPoll)
  const intervalMs = options.intervalMs ?? 2000

  useEffect(() => {
    loadRef.current = load
    pollRef.current = options.shouldPoll
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function run(first: boolean) {
      let result: ApiResult<T>
      try {
        result = await loadRef.current()
      } catch {
        result = { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }
      }
      if (cancelled) return
      if (result.ok) {
        setResource({ status: 'ready', data: result.data })
        if (pollRef.current?.(result.data)) timer = setTimeout(() => void run(false), intervalMs)
      } else if (first) {
        setResource({ status: 'error', error: result.error })
      } else {
        // Keep showing the last good data; try again later instead of replacing it with an error.
        timer = setTimeout(() => void run(false), intervalMs)
      }
    }

    void run(true)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [tick, intervalMs])

  const reload = useCallback(() => {
    setResource({ status: 'loading' })
    setTick((n) => n + 1)
  }, [])
  return { resource, reload }
}

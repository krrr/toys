/*
 *  Main-thread bridge to the filter worker (vhs_filter.worker.ts).
 *  runFilter() transfers the RGBA buffer in and resolves with the
 *  filtered RGBA buffer; stage progress surfaces through the optional
 *  onProgress callback. One worker is shared for the page's lifetime;
 *  the worker serializes jobs internally.
 */
import type { FilterParams } from './vhs_filter'
import type { FilterRequest, FilterResponse } from './vhs_filter.worker'

export type { FilterParams } from './vhs_filter'

export interface FilterProgress {
    fraction: number // 0..1
    label: string
}

interface PendingJob {
    resolve: (result: Uint8Array<ArrayBuffer>) => void
    reject: (err: Error) => void
    onProgress?: (p: FilterProgress) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingJob>()

function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./vhs_filter.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<FilterResponse>) => {
        const msg = e.data
        if (msg.type === 'progress') {
            const job = pending.get(msg.id)
            if (job?.onProgress) job.onProgress({ fraction: msg.fraction, label: msg.label })
            return
        }
        const job = pending.get(msg.id)
        if (!job) return
        pending.delete(msg.id)
        if (msg.type === 'result') job.resolve(new Uint8Array(msg.buffer))
        else job.reject(new Error(msg.message))
    }
    worker.onerror = (e: ErrorEvent) => {
        const err = new Error(e.message || 'Filter worker crashed')
        for (const job of pending.values()) job.reject(err)
        pending.clear()
        worker = null // respawn on the next call
    }
    return worker
}

export function runFilterWorker(
    imageData: Uint8Array,
    width: number,
    height: number,
    params: FilterParams,
    onProgress?: (p: FilterProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
    const w = ensureWorker()
    const id = nextId++
    const buffer = imageData.buffer as ArrayBuffer // detached by the transfer
    // Snapshot to a plain object: callers may pass a reactive proxy, which
    // the structured clone behind postMessage refuses to serialize.
    const plainParams: FilterParams = { ...params }
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress })
        w.postMessage({ id, buffer, width, height, params: plainParams } satisfies FilterRequest, [buffer])
    })
}

/// <reference lib="webworker" />

/*
 *  Filter worker entry. Owns one serialized job queue: requests posted
 *  while a long run is in flight (e.g. params changed mid-run) execute
 *  strictly one at a time in arrival order, so callers never need to
 *  interleave partial results.
 */
import { applyFilter } from './vhs_filter'
import type { FilterParams } from './vhs_filter'

export interface FilterRequest {
    id: number
    buffer: ArrayBuffer // RGBA bytes; ownership transfers to the worker
    width: number
    height: number
    params: FilterParams
}

export type FilterResponse =
    | { type: 'progress'; id: number; fraction: number; label: string }
    | { type: 'result'; id: number; buffer: ArrayBuffer }
    | { type: 'error'; id: number; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

const queue: FilterRequest[] = []
let draining = false

ctx.onmessage = (e: MessageEvent<FilterRequest>) => {
    queue.push(e.data)
    void drain()
}

async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
        while (queue.length > 0) {
            const job = queue.shift()!
            await runJob(job)
        }
    } finally {
        draining = false
    }
}

async function runJob(job: FilterRequest): Promise<void> {
    const { id, buffer, width, height, params } = job
    try {
        const result = await applyFilter(
            new Uint8Array(buffer),
            width,
            height,
            params,
            (fraction, label) => {
                ctx.postMessage({ type: 'progress', id, fraction, label } satisfies FilterResponse)
            },
        )
        ctx.postMessage(
            { type: 'result', id, buffer: result.buffer } satisfies FilterResponse,
            [result.buffer],
        )
    } catch (err) {
        ctx.postMessage({
            type: 'error',
            id,
            message: err instanceof Error ? err.message : String(err),
        } satisfies FilterResponse)
    }
}

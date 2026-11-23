/**
 * Which transcripts came to an end since the last look at the library: the
 * main process asks the engine's GET /transcripts every few seconds while
 * anything is being made (speechhost.ts), and shows a notification for each
 * transcript that became done or failed (main.ts `transcriptEnded`).
 *
 * The first look is only a baseline: what was done before is never announced.
 * After it, a transcript is announced when it was seen unfinished (recording,
 * queued, working) and is now done or failed, or when it shows up done for the
 * first time (made between two looks). Each once a run: a transcript made
 * again or split by speaker later is not announced again. Voice notes never.
 */

export interface LibraryRow {
  id: string
  title: string
  source: string
  status: string
}

const UNFINISHED = new Set(['recording', 'queued', 'working'])
const ENDED = new Set(['done', 'failed'])

export class TranscriptWatch {
  private baseline = false
  private readonly unfinished = new Set<string>()
  private readonly known = new Set<string>()
  private readonly told = new Set<string>()

  /** A new look at the library: the rows that came to an end since the last one. */
  see(rows: readonly LibraryRow[]): LibraryRow[] {
    const ended: LibraryRow[] = []
    const here = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || row.source === 'note') continue
      here.add(row.id)
      if (UNFINISHED.has(row.status)) {
        this.unfinished.add(row.id)
      } else if (ENDED.has(row.status)) {
        const announce = this.unfinished.has(row.id) || (this.baseline && !this.known.has(row.id))
        this.unfinished.delete(row.id)
        if (announce && !this.told.has(row.id)) {
          this.told.add(row.id)
          ended.push(row)
        }
      }
      this.known.add(row.id)
    }
    // Deleted meanwhile: nothing to wait for.
    for (const id of this.unfinished) if (!here.has(id)) this.unfinished.delete(id)
    this.baseline = true
    return ended
  }

  /** Something is still being made: the library is looked at again. */
  get waiting(): boolean {
    return this.unfinished.size > 0
  }

  /** The first look, the baseline, was made. */
  get started(): boolean {
    return this.baseline
  }
}

import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { flightAnalysisJobs, flights } from '../db/schema';
import {
  generateRemindersForFlight,
  getOwnerProfile,
  resolveProfilePrefs,
} from './logistics';
import { getLocalYmdInTz } from './time';

export const STALE_LOCK_MS = 2 * 60 * 1000;
export const MAX_PARALLEL_PER_WAVE = 6;
export const WAVE_BUDGET_MS = 22_000;

export type AnalysisJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AnalysisJobSummary {
  flightId: number;
  status: AnalysisJobStatus;
  completedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface AnalysisStatusPayload {
  isActive: boolean;
  totalUpcoming: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  activeFlightIds: number[];
  jobs: AnalysisJobSummary[];
}

export async function enqueueFlightsForAnalysis(
  db: DrizzleD1Database,
  flightIds: number[],
  options: { force?: boolean; now?: Date } = {}
): Promise<{ enqueuedIds: number[]; skippedActiveIds: number[] }> {
  const uniqueIds = Array.from(
    new Set(flightIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (uniqueIds.length === 0) {
    return { enqueuedIds: [], skippedActiveIds: [] };
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const staleCutoffIso = new Date(now.getTime() - STALE_LOCK_MS).toISOString();

  const existing = await db
    .select()
    .from(flightAnalysisJobs)
    .where(inArray(flightAnalysisJobs.flightId, uniqueIds))
    .all();
  const existingMap = new Map(existing.map((j) => [j.flightId, j]));

  const enqueuedIds: number[] = [];
  const skippedActiveIds: number[] = [];

  for (const flightId of uniqueIds) {
    const row = existingMap.get(flightId);
    const isActivelyRunning =
      row?.status === 'running' &&
      Boolean(row.startedAt && row.startedAt >= staleCutoffIso);

    if (row?.status === 'queued' || isActivelyRunning) {
      skippedActiveIds.push(flightId);
      continue;
    }

    await db
      .insert(flightAnalysisJobs)
      .values({
        flightId,
        status: 'queued',
        force: Boolean(options.force),
        startedAt: null,
        completedAt: row?.completedAt ?? null,
        lastError: null,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: flightAnalysisJobs.flightId,
        set: {
          status: 'queued',
          force: Boolean(options.force),
          startedAt: null,
          lastError: null,
          updatedAt: nowIso,
        },
      });

    enqueuedIds.push(flightId);
  }

  return { enqueuedIds, skippedActiveIds };
}

export async function recoverStaleAnalysisJobs(
  db: DrizzleD1Database,
  now = new Date()
): Promise<number> {
  const nowIso = now.toISOString();
  const staleCutoffIso = new Date(now.getTime() - STALE_LOCK_MS).toISOString();
  const res = await db
    .update(flightAnalysisJobs)
    .set({
      status: 'queued',
      startedAt: null,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(flightAnalysisJobs.status, 'running'),
        lt(flightAnalysisJobs.startedAt, staleCutoffIso)
      )
    )
    .returning({ flightId: flightAnalysisJobs.flightId });
  return res.length;
}

export async function getAnalysisStatus(
  db: DrizzleD1Database,
  now = new Date()
): Promise<AnalysisStatusPayload> {
  await recoverStaleAnalysisJobs(db, now);

  const [profile, allFlights, allJobs] = await Promise.all([
    getOwnerProfile(db),
    db.select().from(flights).all(),
    db.select().from(flightAnalysisJobs).all(),
  ]);

  const { homeTz } = resolveProfilePrefs(profile);
  const todayLocal = getLocalYmdInTz(now.getTime(), homeTz);
  const upcomingIds = new Set(
    allFlights.filter((f) => f.flightDate >= todayLocal).map((f) => f.id)
  );

  let queued = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  const activeFlightIds: number[] = [];
  const jobs: AnalysisJobSummary[] = [];

  for (const job of allJobs) {
    if (!upcomingIds.has(job.flightId)) continue;
    const status = (job.status || 'queued') as AnalysisJobStatus;
    if (status === 'queued') {
      queued++;
      activeFlightIds.push(job.flightId);
    } else if (status === 'running') {
      running++;
      activeFlightIds.push(job.flightId);
    } else if (status === 'completed') {
      completed++;
    } else if (status === 'failed') {
      failed++;
    }
    jobs.push({
      flightId: job.flightId,
      status,
      completedAt: job.completedAt ?? null,
      lastError: job.lastError ?? null,
      updatedAt: job.updatedAt,
    });
  }

  return {
    isActive: queued + running > 0,
    totalUpcoming: upcomingIds.size,
    queued,
    running,
    completed,
    failed,
    activeFlightIds,
    jobs,
  };
}

export async function processAnalysisQueueWave(
  env: { DB: D1Database; GEMINI_API_KEY?: string },
  options: { maxWallMs?: number; maxParallel?: number; now?: Date } = {}
): Promise<{ processed: number; failed: number; remainingQueued: number }> {
  const db = drizzle(env.DB);
  const startNow = options.now ?? new Date();
  const startMs = Date.now();
  const maxWallMs = options.maxWallMs ?? WAVE_BUDGET_MS;
  const maxParallel = options.maxParallel ?? MAX_PARALLEL_PER_WAVE;

  await recoverStaleAnalysisJobs(db, startNow);

  if (!env.GEMINI_API_KEY) {
    const queuedRows = await db
      .select()
      .from(flightAnalysisJobs)
      .where(eq(flightAnalysisJobs.status, 'queued'))
      .all();
    if (queuedRows.length > 0) {
      const errIso = new Date().toISOString();
      await db
        .update(flightAnalysisJobs)
        .set({
          status: 'failed',
          lastError: 'GEMINI_API_KEY is not configured.',
          updatedAt: errIso,
        })
        .where(eq(flightAnalysisJobs.status, 'queued'));
    }
    return { processed: 0, failed: queuedRows.length, remainingQueued: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (let wave = 0; wave < 2; wave++) {
    const elapsed = Date.now() - startMs;
    if (wave > 0 && elapsed >= 11_000) {
      break;
    }

    const candidates = await db
      .select()
      .from(flightAnalysisJobs)
      .where(eq(flightAnalysisJobs.status, 'queued'))
      .orderBy(asc(flightAnalysisJobs.updatedAt), asc(flightAnalysisJobs.flightId))
      .limit(maxParallel)
      .all();

    if (candidates.length === 0) {
      break;
    }

    const claimIso = new Date().toISOString();
    const claimed: typeof candidates = [];

    for (const candidate of candidates) {
      const claimRes = await env.DB.prepare(
        'UPDATE flight_analysis_jobs SET status = ?, started_at = ?, updated_at = ? WHERE flight_id = ? AND status = ?'
      )
        .bind('running', claimIso, claimIso, candidate.flightId, 'queued')
        .run();

      const changes = Number((claimRes as any)?.meta?.changes ?? 0);
      if (changes === 1) {
        claimed.push(candidate);
      }
    }

    if (claimed.length === 0) {
      break;
    }

    const waveFlightRows = await db
      .select()
      .from(flights)
      .where(
        inArray(
          flights.id,
          claimed.map((c) => c.flightId)
        )
      )
      .all();
    const flightMap = new Map(waveFlightRows.map((f) => [f.id, f]));
    const timeoutBudget = Math.max(8_000, Math.min(18_000, maxWallMs - (Date.now() - startMs)));

    await Promise.allSettled(
      claimed.map(async (job) => {
        const flight = flightMap.get(job.flightId);
        const doneAt = new Date();
        const doneIso = doneAt.toISOString();

        if (!flight) {
          await db
            .delete(flightAnalysisJobs)
            .where(eq(flightAnalysisJobs.flightId, job.flightId));
          return;
        }

        try {
          await generateRemindersForFlight(db, env, flight, {
            force: Boolean(job.force),
            timeoutMs: timeoutBudget,
          });
          await db
            .update(flightAnalysisJobs)
            .set({
              status: 'completed',
              startedAt: null,
              completedAt: doneIso,
              lastError: null,
              updatedAt: doneIso,
            })
            .where(eq(flightAnalysisJobs.flightId, job.flightId));
          processed++;
        } catch (err: any) {
          const msg = String(err?.message || err || 'Analysis failed').slice(0, 300);
          await db
            .update(flightAnalysisJobs)
            .set({
              status: 'failed',
              startedAt: null,
              lastError: msg,
              updatedAt: doneIso,
            })
            .where(eq(flightAnalysisJobs.flightId, job.flightId));
          failed++;
        }
      })
    );
  }

  const remaining = await db
    .select({ flightId: flightAnalysisJobs.flightId })
    .from(flightAnalysisJobs)
    .where(eq(flightAnalysisJobs.status, 'queued'))
    .all();

  return {
    processed,
    failed,
    remainingQueued: remaining.length,
  };
}

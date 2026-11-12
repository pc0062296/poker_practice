import { solveReference, type SolveJob, type SolverReference } from '../solver/reference';
import { gradePostflop, type GradingJob, type PostflopGrade } from './postflop';

interface Pending {
  onGrade?: (grade: PostflopGrade) => void;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
}

interface Reply {
  id: number;
  grade?: PostflopGrade;
  done?: boolean;
  grades?: PostflopGrade[];
  reference?: SolverReference | null;
  error?: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const job = pending.get(reply.id);
    if (!job) return;
    if (reply.grade) job.onGrade?.(reply.grade);
    if (reply.done) {
      pending.delete(reply.id);
      if (reply.error) job.reject(new Error(reply.error));
      else job.resolve(reply);
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Grading worker failed');
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Grade a hand's postflop decisions off the main thread. Jobs run one after another. */
export function gradeInBackground(job: GradingJob, onGrade?: (grade: PostflopGrade) => void): Promise<PostflopGrade[]> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(gradePostflop(job, onGrade));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  const id = nextId++;
  return new Promise<Reply>((resolve, reject) => {
    pending.set(id, { onGrade, resolve, reject });
    w.postMessage({ id, job });
  }).then((reply) => reply.grades ?? []);
}

/** Solve a heads-up turn or river decision off the main thread (null when not applicable). */
export function solveInBackground(job: SolveJob): Promise<SolverReference | null> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(solveReference(job));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  const id = nextId++;
  return new Promise<Reply>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, kind: 'solve', job });
  }).then((reply) => reply.reference ?? null);
}

/** Number of hands still waiting to be graded. */
export function gradingBacklog(): number {
  return pending.size;
}

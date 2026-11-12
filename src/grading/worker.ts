import { installOverrides } from '../ranges/overrides';
import { solveReference, type SolveJob } from '../solver/reference';
import { gradePostflop, type GradingJob } from './postflop';

type Request = { id: number; kind?: 'grade'; job: GradingJob } | { id: number; kind: 'solve'; job: SolveJob };

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  const { id } = request;
  try {
    installOverrides(request.job.chartOverrides ?? {});
    if (request.kind === 'solve') {
      scope.postMessage({ id, done: true, reference: solveReference(request.job) });
      return;
    }
    const grades = gradePostflop(request.job, (grade) => scope.postMessage({ id, grade }));
    scope.postMessage({ id, done: true, grades });
  } catch (error) {
    scope.postMessage({ id, done: true, error: String(error) });
  }
};

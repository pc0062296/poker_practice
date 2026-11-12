import { installOverrides } from '../ranges/overrides';
import { gradePostflop, type GradingJob } from './postflop';

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<{ id: number; job: GradingJob }>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, job } = event.data;
  try {
    installOverrides(job.chartOverrides ?? {});
    const grades = gradePostflop(job, (grade) => scope.postMessage({ id, grade }));
    scope.postMessage({ id, done: true, grades });
  } catch (error) {
    scope.postMessage({ id, done: true, error: String(error) });
  }
};

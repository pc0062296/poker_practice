import { allChartOverrides, chartKeys, setChartOverride, type ChartDepth, type ChartSpec } from './charts';
import { tryParseRange } from './rangeString';

const STORAGE_KEY = 'poker-practice.charts.v1';

/** The exported file format. */
export interface ChartExport {
  format: 'poker-practice-charts';
  version: 1;
  charts: Record<string, ChartSpec>;
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(allChartOverrides()));
  } catch {
    // Storage unavailable; changes last for this visit.
  }
}

/** Install a set of user charts ("depth|key" -> spec), replacing the current ones. */
export function installOverrides(charts: Record<string, ChartSpec>): void {
  for (const id of Object.keys(allChartOverrides())) {
    const [depth, key] = splitId(id);
    setChartOverride(key, depth, null);
  }
  for (const [id, spec] of Object.entries(charts)) {
    const [depth, key] = splitId(id);
    setChartOverride(key, depth, spec);
  }
}

function splitId(id: string): [ChartDepth, string] {
  const bar = id.indexOf('|');
  return [Number(id.slice(0, bar)) === 100 ? 100 : 200, id.slice(bar + 1)];
}

/** Load the user's charts saved on this device. Call once at startup. */
export function loadStoredOverrides(): void {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!text) return;
    const parsed = JSON.parse(text) as Record<string, ChartSpec>;
    installOverrides(validCharts(parsed).charts);
  } catch {
    // Ignore unreadable data.
  }
}

export function saveOverride(key: string, depth: ChartDepth, spec: ChartSpec | null): void {
  setChartOverride(key, depth, spec);
  persist();
}

export function exportOverrides(): string {
  const data: ChartExport = { format: 'poker-practice-charts', version: 1, charts: allChartOverrides() };
  return JSON.stringify(data, null, 2);
}

function validCharts(raw: Record<string, unknown>): { charts: Record<string, ChartSpec>; errors: string[] } {
  const known = new Set(chartKeys());
  const charts: Record<string, ChartSpec> = {};
  const errors: string[] = [];
  for (const [id, value] of Object.entries(raw)) {
    const [, key] = splitId(id.includes('|') ? id : `200|${id}`);
    const spec = value as Partial<ChartSpec> | null;
    if (!known.has(key) || !spec || typeof spec.raise !== 'string' || typeof spec.call !== 'string') {
      errors.push(id);
      continue;
    }
    const bad = [...tryParseRange(spec.raise).errors, ...tryParseRange(spec.call).errors];
    if (bad.length > 0) {
      errors.push(`${id}: ${bad.join(', ')}`);
      continue;
    }
    charts[id.includes('|') ? id : `200|${id}`] = { raise: spec.raise, call: spec.call };
  }
  return { charts, errors };
}

/** Import charts from an exported file. Returns how many were installed and what was skipped. */
export function importOverrides(text: string): { count: number; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { count: 0, errors: ['JSON'] };
  }
  const body = (raw as Partial<ChartExport>)?.charts ?? raw;
  if (!body || typeof body !== 'object') return { count: 0, errors: ['JSON'] };
  const { charts, errors } = validCharts(body as Record<string, unknown>);
  for (const [id, spec] of Object.entries(charts)) {
    const [depth, key] = splitId(id);
    setChartOverride(key, depth, spec);
  }
  persist();
  return { count: Object.keys(charts).length, errors };
}

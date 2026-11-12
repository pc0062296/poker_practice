import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CLASS_LABELS, NUM_CLASSES } from '../../eval/handClass';
import { fmt, messages } from '../../i18n';
import { chartKeys, chartOverride, getChart, type ChartDepth } from '../../ranges/charts';
import { exportOverrides, importOverrides, saveOverride } from '../../ranges/overrides';
import { formatRange, rangeFraction, tryParseRange } from '../../ranges/rangeString';
import { chartGroup, chartLabel } from '../chartLabels';

type Tool = 'raise' | 'call' | 'fold' | 'raiseHalf' | 'callHalf' | 'mixed';
const TOOLS: Tool[] = ['raise', 'call', 'fold', 'raiseHalf', 'callHalf', 'mixed'];
const TOOL_VALUES: Record<Tool, [number, number]> = {
  raise: [1, 0],
  call: [0, 1],
  fold: [0, 0],
  raiseHalf: [0.5, 0],
  callHalf: [0, 0.5],
  mixed: [0.5, 0.5],
};
const GROUP_ORDER = ['rfi', 'vsLimp', 'vsOpen', 'vs3bet', 'other'];

interface Draft {
  raise: Float32Array;
  call: Float32Array;
}

function loadDraft(key: string, depth: ChartDepth): Draft {
  const chart = getChart(key, depth)!;
  return { raise: chart.raise.slice(), call: chart.call.slice() };
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RangesScreen() {
  const t = messages.rangesScreen;
  const keys = useMemo(() => chartKeys(), []);
  const [depth, setDepth] = useState<ChartDepth>(200);
  const [key, setKey] = useState('rfi:UTG');
  const [draft, setDraft] = useState<Draft>(() => loadDraft('rfi:UTG', 200));
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('raise');
  const [raiseText, setRaiseText] = useState('');
  const [callText, setCallText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const painting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = loadDraft(key, depth);
    setDraft(d);
    setRaiseText(formatRange(d.raise));
    setCallText(formatRange(d.call));
    setDirty(false);
    setMessage(null);
  }, [key, depth, version]);

  useEffect(() => {
    const stop = () => {
      painting.current = false;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const paint = (k: number) => {
    const [r, c] = TOOL_VALUES[tool];
    if (draft.raise[k] === r && draft.call[k] === c) return;
    const next = { raise: draft.raise.slice(), call: draft.call.slice() };
    next.raise[k] = r;
    next.call[k] = c;
    setDraft(next);
    setRaiseText(formatRange(next.raise));
    setCallText(formatRange(next.call));
    setDirty(true);
  };

  const applyText = () => {
    const raise = tryParseRange(raiseText);
    const call = tryParseRange(callText);
    const errors = [...raise.errors, ...call.errors];
    if (errors.length > 0) {
      setMessage(fmt(t.parseErrors, { list: errors.join(', ') }));
      return;
    }
    const next = { raise: raise.weights, call: new Float32Array(NUM_CLASSES) };
    for (let k = 0; k < NUM_CLASSES; k++) next.call[k] = Math.min(call.weights[k]!, 1 - raise.weights[k]!);
    setDraft(next);
    setDirty(true);
    setMessage(null);
  };

  const save = () => {
    saveOverride(key, depth, { raise: formatRange(draft.raise), call: formatRange(draft.call) });
    setDirty(false);
    setVersion((v) => v + 1);
  };

  const reset = () => {
    saveOverride(key, depth, null);
    setVersion((v) => v + 1);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const result = importOverrides(text);
    const parts = [fmt(t.imported, { n: result.count })];
    if (result.errors.length > 0) parts.push(fmt(t.importErrors, { list: result.errors.slice(0, 5).join(', ') }));
    setMessage(parts.join(messages.symbols.separator));
    setVersion((v) => v + 1);
  };

  const customized = (k: string) => chartOverride(k, depth) !== null;
  const raiseShare = rangeFraction(draft.raise) * 100;
  const callShare = rangeFraction(draft.call) * 100;

  return (
    <main className="screen">
      <div className="screen-body ranges">
        <aside className="panel chart-list">
          <div className="filter-row">
            <span className="filter-label">{t.depth}</span>
            {([100, 200] as ChartDepth[]).map((d) => (
              <button key={d} className={`chip ${depth === d ? 'chip-on' : ''}`} onClick={() => setDepth(d)}>
                {d} BB
              </button>
            ))}
          </div>
          <select className="select chart-select" value={key} onChange={(e) => setKey(e.target.value)}>
            {GROUP_ORDER.map((g) => (
              <optgroup key={g} label={messages.chartGroup[g]}>
                {keys
                  .filter((k) => chartGroup(k) === g)
                  .map((k) => (
                    <option key={k} value={k}>
                      {chartLabel(k)}
                      {customized(k) ? ` (${t.custom})` : ''}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <div className="chart-groups">
            {GROUP_ORDER.map((g) => (
              <div key={g}>
                <h3 className="panel-title">{messages.chartGroup[g]}</h3>
                {keys
                  .filter((k) => chartGroup(k) === g)
                  .map((k) => (
                    <button key={k} className={`chart-item ${k === key ? 'chart-item-on' : ''}`} onClick={() => setKey(k)}>
                      <span>{chartLabel(k)}</span>
                      {customized(k) && <em className="chart-custom">{t.custom}</em>}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="panel chart-editor">
          <div className="grade-head">
            <span className="grade-scenario">
              {chartLabel(key)}
              {messages.symbols.separator}
              {depth} BB
            </span>
            <span className={`badge ${customized(key) ? 'badge-ok' : 'badge-ungraded'}`}>{customized(key) ? t.custom : t.builtin}</span>
          </div>
          <div className="filter-row">
            {TOOLS.map((x) => (
              <button key={x} className={`chip tool-${x} ${tool === x ? 'chip-on' : ''}`} onClick={() => setTool(x)}>
                {t.tools[x]}
              </button>
            ))}
          </div>
          <p className="settings-note">{t.paint}</p>
          <div className="range-grid range-edit" onPointerLeave={() => (painting.current = false)}>
            {CLASS_LABELS.map((label, k) => {
              const r = Math.round(draft.raise[k]! * 100);
              const c = Math.round(draft.call[k]! * 100);
              const style: CSSProperties = {
                background: `linear-gradient(to right, var(--c-raise) 0 ${r}%, var(--c-call) ${r}% ${r + c}%, var(--c-fold-cell) ${r + c}% 100%)`,
              };
              return (
                <div
                  key={label}
                  className={`range-cell ${r + c === 0 ? 'range-cell-fold' : ''}`}
                  style={style}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    painting.current = true;
                    paint(k);
                  }}
                  onPointerEnter={() => {
                    if (painting.current) paint(k);
                  }}
                >
                  {label}
                </div>
              );
            })}
          </div>
          <div className="range-legend">
            <span>
              <i className="swatch swatch-raise" />
              {messages.chart.raise} {raiseShare.toFixed(1)}%
            </span>
            <span>
              <i className="swatch swatch-call" />
              {messages.chart.call} {callShare.toFixed(1)}%
            </span>
          </div>

          <label className="text-field">
            <span>{t.raiseText}</span>
            <textarea value={raiseText} rows={2} onChange={(e) => setRaiseText(e.target.value)} spellCheck={false} />
          </label>
          <label className="text-field">
            <span>{t.callText}</span>
            <textarea value={callText} rows={2} onChange={(e) => setCallText(e.target.value)} spellCheck={false} />
          </label>
          <p className="settings-note">{t.textHelp}</p>
          {message && <p className="form-message">{message}</p>}
          <div className="button-row">
            <button className="btn btn-plain" onClick={applyText}>
              {t.applyText}
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty}>
              {t.save}
            </button>
            {dirty && <span className="unsaved">{t.unsaved}</span>}
            <span className="spacer" />
            <button className="btn btn-plain" onClick={reset} disabled={!customized(key)}>
              {t.reset}
            </button>
          </div>
          <div className="button-row">
            <button className="btn btn-plain" onClick={() => download('poker-practice-charts.json', exportOverrides())}>
              {t.exportAll}
            </button>
            <button className="btn btn-plain" onClick={() => fileRef.current?.click()}>
              {t.importFile}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json,.txt"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImport(file);
                e.target.value = '';
              }}
            />
          </div>
          <p className="grade-note">{t.note}</p>
        </section>
      </div>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DRILL_FILTER,
  DRILL_KINDS,
  gradeChoice,
  loadDrillRecords,
  makeQuestion,
  PREFLOP_ORDER,
  saveDrillRecords,
  type DrillChoice,
  type DrillFilter,
  type DrillQuestion,
  type DrillRecord,
  type DrillVerdict,
} from '../../drills/preflopDrill';
import { cryptoRng } from '../../engine/rng';
import type { PositionName } from '../../engine/types';
import { CLASS_LABELS } from '../../eval/handClass';
import { fmt, messages } from '../../i18n';
import { getChart } from '../../ranges/charts';
import { useGame } from '../../store/gameStore';
import { chartLabel } from '../chartLabels';
import { CardView } from '../components/CardView';
import { RangeGrid } from '../components/RangeGrid';

const rng = cryptoRng();
const FILTER_KEY = 'poker-practice.drillFilter.v1';

function loadFilter(): DrillFilter {
  try {
    const text = globalThis.localStorage?.getItem(FILTER_KEY);
    if (!text) return DEFAULT_DRILL_FILTER;
    const raw = JSON.parse(text) as Partial<DrillFilter>;
    return {
      kinds: (raw.kinds ?? DEFAULT_DRILL_FILTER.kinds).filter((k) => DRILL_KINDS.includes(k)),
      positions: (raw.positions ?? []).filter((p) => PREFLOP_ORDER.includes(p)),
      depth: raw.depth === 100 || raw.depth === 200 || raw.depth === 'mixed' ? raw.depth : 200,
      focusClose: raw.focusClose ?? true,
    };
  } catch {
    return DEFAULT_DRILL_FILTER;
  }
}

function threeBetSize(villain: PositionName | null): number {
  return villain === 'SB' || villain === 'BB' ? 13.5 : 10.5;
}

function spotText(q: DrillQuestion): string {
  const t = messages.drill.spot;
  const params = {
    hero: q.heroPosition,
    villain: q.villainPosition ?? '',
    third: q.thirdPosition ?? '',
    size: threeBetSize(q.villainPosition),
  };
  if (q.kind === 'vsLimp' && q.heroPosition === 'BB') return fmt(t.vsLimpBB!, params);
  return fmt(t[q.kind]!, params);
}

/** Positions at the table with the roles in this spot. */
function SpotSeats({ q }: { q: DrillQuestion }) {
  return (
    <div className="spot-seats">
      {PREFLOP_ORDER.map((p) => {
        let role = '';
        if (p === q.heroPosition) role = 'hero';
        else if (p === q.villainPosition) role = 'villain';
        else if (p === q.thirdPosition) role = 'third';
        return (
          <span key={p} className={`spot-seat ${role ? `spot-${role}` : ''}`}>
            {p}
          </span>
        );
      })}
    </div>
  );
}

export function DrillScreen() {
  const fourColor = useGame((s) => s.settings.fourColor);
  const [filter, setFilter] = useState<DrillFilter>(loadFilter);
  const [question, setQuestion] = useState<DrillQuestion | null>(() => makeQuestion(loadFilter(), rng));
  const [answer, setAnswer] = useState<{ choice: DrillChoice; verdict: DrillVerdict } | null>(null);
  const [records, setRecords] = useState<Record<string, DrillRecord>>(loadDrillRecords);
  const [session, setSession] = useState({ answered: 0, good: 0 });
  const t = messages.drill;

  const updateFilter = (next: DrillFilter) => {
    setFilter(next);
    try {
      globalThis.localStorage?.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      // Not saved.
    }
    setQuestion(makeQuestion(next, rng));
    setAnswer(null);
  };

  const next = useCallback(() => {
    setQuestion(makeQuestion(filter, rng));
    setAnswer(null);
  }, [filter]);

  const choose = useCallback(
    (choice: DrillChoice) => {
      if (!question || answer) return;
      const verdict = gradeChoice(question, choice);
      setAnswer({ choice, verdict });
      const good = verdict === 'best' || verdict === 'ok';
      setSession((s) => ({ answered: s.answered + 1, good: s.good + (good ? 1 : 0) }));
      setRecords((prev) => {
        const key = `${question.depth}|${question.chartKey}`;
        const r = prev[key] ?? { answered: 0, good: 0 };
        const updated = { ...prev, [key]: { answered: r.answered + 1, good: r.good + (good ? 1 : 0) } };
        saveDrillRecords(updated);
        return updated;
      });
    },
    [question, answer],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (answer && (key === ' ' || key === 'enter' || key === 'n')) {
        e.preventDefault();
        next();
      } else if (!answer && question) {
        if (key === 'f' && !question.canCheck) choose('fold');
        else if (key === 'c') choose('call');
        else if (key === 'r') choose('raise');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, question, next, choose]);

  const weakest = useMemo(
    () =>
      Object.entries(records)
        .filter(([, r]) => r.answered >= 3)
        .map(([id, r]) => ({ id, rate: r.good / r.answered, n: r.answered }))
        .sort((a, b) => a.rate - b.rate)
        .slice(0, 5),
    [records],
  );

  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const chart = question ? getChart(question.chartKey, question.depth) : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const choices: DrillChoice[] = question?.canCheck ? ['call', 'raise'] : ['fold', 'call', 'raise'];
  const choiceLabel = (c: DrillChoice) =>
    c === 'call' && question?.canCheck ? messages.choice.check : messages.choice[c];

  return (
    <main className="screen">
      <div className="screen-body drill">
        <section className="panel filters">
          <div className="filter-row">
            {DRILL_KINDS.map((k) => (
              <button
                key={k}
                className={`chip ${filter.kinds.includes(k) ? 'chip-on' : ''}`}
                onClick={() => {
                  const kinds = toggle(filter.kinds, k);
                  if (kinds.length > 0) updateFilter({ ...filter, kinds });
                }}
              >
                {t.kinds[k]}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">{t.positions}</span>
            <button className={`chip ${filter.positions.length === 0 ? 'chip-on' : ''}`} onClick={() => updateFilter({ ...filter, positions: [] })}>
              {t.all}
            </button>
            {PREFLOP_ORDER.map((p) => (
              <button key={p} className={`chip ${filter.positions.includes(p) ? 'chip-on' : ''}`} onClick={() => updateFilter({ ...filter, positions: toggle(filter.positions, p) })}>
                {p}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">{t.depth}</span>
            {([100, 200, 'mixed'] as const).map((d) => (
              <button key={d} className={`chip ${filter.depth === d ? 'chip-on' : ''}`} onClick={() => updateFilter({ ...filter, depth: d })}>
                {d === 'mixed' ? t.mixed : `${d} BB`}
              </button>
            ))}
            <label className="check">
              <input type="checkbox" checked={filter.focusClose} onChange={(e) => updateFilter({ ...filter, focusClose: e.target.checked })} />
              {t.focusClose}
            </label>
          </div>
        </section>

        {!question ? (
          <p className="panel-empty">{t.noSpots}</p>
        ) : (
          <section className="panel drill-card">
            <div className="drill-head">
              <span className="drill-spot">{spotText(question)}</span>
              <span className="drill-depth">{fmt(t.depthNote, { depth: question.depth })}</span>
            </div>
            <SpotSeats q={question} />
            <div className="drill-hand">
              {question.hand.map((c) => (
                <CardView key={c} card={c} fourColor={fourColor} size="lg" />
              ))}
            </div>
            <div className="drill-buttons">
              {choices.map((c) => (
                <button
                  key={c}
                  className={`btn btn-${c === 'fold' ? 'fold' : c === 'call' ? 'call' : 'raise'} ${answer?.choice === c ? 'btn-picked' : ''}`}
                  disabled={!!answer}
                  onClick={() => choose(c)}
                >
                  {choiceLabel(c)}
                  <kbd>{c === 'fold' ? 'F' : c === 'call' ? 'C' : 'R'}</kbd>
                </button>
              ))}
            </div>
            {answer && (
              <div className="drill-result">
                <div className="grade-head">
                  <span className="grade-scenario">
                    {chartLabel(question.chartKey)}
                    {messages.symbols.separator}
                    {CLASS_LABELS[question.handClass]}
                  </span>
                  <span className={`badge badge-${answer.verdict}`}>{messages.verdict[answer.verdict]}</span>
                </div>
                <div className="freq-bar" aria-hidden="true">
                  {(['raise', 'call', 'fold'] as DrillChoice[]).map((c) =>
                    question.freq[c] > 0.005 ? <div key={c} className={`freq freq-${c}`} style={{ flexGrow: question.freq[c] }} /> : null,
                  )}
                </div>
                <div className="freq-text">
                  <span className="freq-title">{t.correctAnswer}</span>
                  {(['raise', 'call', 'fold'] as DrillChoice[]).map((c) =>
                    question.freq[c] > 0.005 ? (
                      <span key={c} className={`freq-item ${c === answer.choice ? 'freq-item-chosen' : ''}`}>
                        {choiceLabel(c)} {pct(question.freq[c])}
                      </span>
                    ) : null,
                  )}
                </div>
                {chart && <RangeGrid chart={chart} highlight={question.handClass} />}
                <button className="btn btn-primary drill-next" onClick={next}>
                  {t.next}
                  <kbd>{messages.keys.next}</kbd>
                </button>
              </div>
            )}
          </section>
        )}

        <section className="panel drill-stats">
          <div className="drill-score">
            <span>{fmt(t.answered, { n: session.answered })}</span>
            {session.answered > 0 && <span>{fmt(t.accuracy, { x: Math.round((session.good / session.answered) * 100) })}</span>}
          </div>
          {weakest.length > 0 && (
            <>
              <h3 className="panel-title">{t.weakest}</h3>
              <ul className="weak-list">
                {weakest.map((w) => {
                  const [depth, key] = [w.id.slice(0, w.id.indexOf('|')), w.id.slice(w.id.indexOf('|') + 1)];
                  return (
                    <li key={w.id}>
                      <span>
                        {chartLabel(key)} <em>{depth} BB</em>
                      </span>
                      <span>
                        {Math.round(w.rate * 100)}% <em>({w.n})</em>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                className="link-button"
                onClick={() => {
                  setRecords({});
                  saveDrillRecords({});
                }}
              >
                {t.reset}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

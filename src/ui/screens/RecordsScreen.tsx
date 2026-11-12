import { useEffect, useMemo, useRef, useState } from 'react';
import { DRILL_KINDS, type DrillKind } from '../../drills/preflopDrill';
import { replayHand } from '../../engine/hand';
import type { PositionName } from '../../engine/types';
import type { StatSummary } from '../../game/stats';
import type { PreflopChoice } from '../../grading/preflop';
import { fmt, messages } from '../../i18n';
import { reviewFromRecord } from '../../review/model';
import { exportBackup, importBackup } from '../../storage/backup';
import { listHands, type StoredHand } from '../../storage/handStore';
import { useGame } from '../../store/gameStore';
import { useNav } from '../../store/nav';
import { useReviewUi } from '../../store/reviewUi';
import {
  collectMistakes,
  isDue,
  loadSchedule,
  nextSchedule,
  postflopAnswerOk,
  preflopAnswerOk,
  saveSchedule,
  type MistakeItem,
} from '../../stats/mistakes';
import { buildReport, STAT_TARGETS, type Report } from '../../stats/report';
import { UNITS_PER_BB } from '../../store/settings';
import { BarChart, LineChart } from '../components/Charts';
import { CardView } from '../components/CardView';
import { GradeCard, scenarioText } from '../components/Feedback';
import { PostflopCard } from '../components/PostflopCard';
import { TableCanvas } from '../components/TableView';
import { cardText, formatAmount, formatSigned } from '../format';

type Tab = 'report' | 'hands' | 'mistakes' | 'backup';
const SERIES_1 = '#3987e5';
const SERIES_2 = '#d95926';
const GROUP_POSITIONS: Record<string, PositionName[]> = {
  EP: ['UTG', 'UTG+1', 'UTG+2'],
  MP: ['LJ', 'HJ'],
  CO: ['CO'],
  BTN: ['BTN'],
  SB: ['SB'],
  BB: ['BB'],
};
const KIND_TO_DRILL: Record<string, DrillKind> = {
  rfi: 'rfi',
  vsLimp: 'vsLimp',
  vsOpen: 'vsOpen',
  squeeze: 'vsOpen',
  vs3bet: 'vs3bet',
  cold3bet: 'cold3bet',
  vs4bet: 'vs4bet',
};

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pct = (x: number | null) => (x === null ? messages.stats.none : `${Math.round(x * 100)}%`);

function ReportView({ hands, sessionOnly }: { hands: StoredHand[]; sessionOnly: boolean }) {
  const settings = useGame((s) => s.settings);
  const setView = useNav((s) => s.setView);
  const t = messages.records;
  const [table, setTable] = useState(false);
  const scoped = useMemo(() => {
    if (!sessionOnly || hands.length === 0) return hands;
    const latest = hands.reduce((a, b) => (b.time > a.time ? b : a));
    return hands.filter((h) => h.sessionId === latest.sessionId);
  }, [hands, sessionOnly]);
  const report: Report = useMemo(() => buildReport(scoped), [scoped]);
  const s = report.summary;
  if (s.hands === 0) return <p className="panel-empty">{t.empty}</p>;

  const tiles = [
    { label: t.summary.hands, value: String(s.hands) },
    { label: t.summary.net, value: formatSigned(s.net, settings), tone: s.net },
    { label: t.summary.evNet, value: formatSigned(s.evNet, settings), tone: s.evNet },
    { label: t.summary.winRate, value: ((s.evNet / UNITS_PER_BB / s.hands) * 100).toFixed(1) },
    { label: t.summary.preflop, value: pct(s.preflopGraded > 0 ? s.preflopGood / s.preflopGraded : null) },
    { label: t.summary.postflop, value: pct(s.postflopGraded > 0 ? s.postflopGood / s.postflopGraded : null) },
    { label: t.summary.evLoss, value: s.postflopGraded > 0 ? ((s.evLoss / UNITS_PER_BB / s.hands) * 100).toFixed(1) : messages.stats.none },
  ];
  const statKeys = Object.keys(STAT_TARGETS) as (keyof StatSummary)[];
  const progressLabels = report.progress.map((p) => fmt(t.upTo, { n: p.upTo }));
  const bucket = report.progress[0]?.hands ?? 0;

  const practicePreflop = (kind: string, group: string) => {
    const filter = {
      kinds: [KIND_TO_DRILL[kind] ?? 'rfi'],
      positions: GROUP_POSITIONS[group] ?? [],
      depth: 200,
      focusClose: true,
    };
    try {
      globalThis.localStorage?.setItem('poker-practice.drillFilter.v1', JSON.stringify(filter));
    } catch {
      // Not saved; the drill opens with its last filter.
    }
    setView('drill');
  };

  return (
    <>
      <section className="panel">
        <div className="tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className="tile">
              <span className="stat-label">{tile.label}</span>
              <span className={`tile-value ${tile.tone === undefined ? '' : tile.tone > 0 ? 'amount-win' : tile.tone < 0 ? 'amount-lose' : ''}`}>
                {tile.value}
              </span>
            </div>
          ))}
        </div>
        <p className="settings-note">{t.evNote}</p>
      </section>

      <section className="panel">
        <h3 className="panel-title">{t.leaksTitle}</h3>
        <h4 className="sub-title">{t.postflopLeaks}</h4>
        {report.postflopLeaks.length === 0 ? (
          <p className="panel-empty">{messages.stats.none}</p>
        ) : (
          <ul className="leak-list">
            {report.postflopLeaks.slice(0, 6).map((l) => {
              const top = (Object.entries(l.directions) as [string, number][]).sort((a, b) => b[1] - a[1])[0]!;
              return (
                <li key={l.key}>
                  <strong>
                    {messages.street[l.street]}
                    {messages.symbols.separator}
                    {t.situation[l.situation]}
                  </strong>
                  <span>{fmt(t.leakLine, { n: l.graded, wrong: l.wrong, loss: formatAmount(l.evLoss, settings, true) })}</span>
                  {top[1] > 0 && <em>{t.direction[top[0]]}</em>}
                </li>
              );
            })}
          </ul>
        )}
        <h4 className="sub-title">{t.preflopLeaks}</h4>
        {report.preflopLeaks.length === 0 ? (
          <p className="panel-empty">{messages.stats.none}</p>
        ) : (
          <ul className="leak-list">
            {report.preflopLeaks.slice(0, 6).map((l) => {
              const top = (Object.entries(l.wrongChoices) as [PreflopChoice, number][]).sort((a, b) => b[1] - a[1])[0]!;
              return (
                <li key={l.key}>
                  <strong>
                    {messages.drill.kinds[KIND_TO_DRILL[l.kind] ?? 'rfi']}
                    {messages.symbols.separator}
                    {messages.positionGroup[l.group]}
                  </strong>
                  <span>{fmt(t.preflopLine, { n: l.graded, wrong: l.wrong, rate: Math.round((l.wrong / l.graded) * 100) })}</span>
                  <em>{t.choice[top[0]]}</em>
                  {DRILL_KINDS.includes(KIND_TO_DRILL[l.kind]!) && (
                    <button className="link-button" onClick={() => practicePreflop(l.kind, l.group)}>
                      {t.practice}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <h3 className="panel-title">{t.statsTitle}</h3>
        <table className="stat-table target-table">
          <tbody>
            {statKeys.map((k) => {
              const value = report.heroStats[k] as number | null;
              const [lo, hi] = STAT_TARGETS[k]!;
              const isRatio = k === 'aggression';
              const show = (x: number) => (isRatio ? x.toFixed(1) : `${Math.round(x * 100)}%`);
              const state = value === null ? '' : value < lo ? 'low' : value > hi ? 'high' : 'inRange';
              return (
                <tr key={k}>
                  <td className="stat-name">{t.stat[k]}</td>
                  <td>{value === null ? messages.stats.none : show(value)}</td>
                  <td className="target-range">{fmt(t.range, { lo: show(lo), hi: show(hi) })}</td>
                  <td>{state && <span className={`badge badge-${state === 'inRange' ? 'best' : 'inaccuracy'}`}>{t[state as 'low' | 'high' | 'inRange']}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="settings-note">{t.statsNote}</p>
      </section>

      <section className="panel">
        <h3 className="panel-title">{t.progressTitle}</h3>
        {report.progress.length < 2 ? (
          <p className="panel-empty">{t.progressNeedMore}</p>
        ) : (
          <>
            <h4 className="sub-title">{fmt(t.accuracyChart, { n: bucket })}</h4>
            <div className="chart-legend">
              <span>
                <i className="chart-swatch" style={{ background: SERIES_1 }} />
                {t.preflopSeries}
              </span>
              <span>
                <i className="chart-swatch" style={{ background: SERIES_2 }} />
                {t.postflopSeries}
              </span>
            </div>
            <LineChart
              title={fmt(t.accuracyChart, { n: bucket })}
              labels={progressLabels}
              yMax={1}
              format={(v) => `${Math.round(v * 100)}%`}
              series={[
                { name: t.preflopSeries, color: SERIES_1, values: report.progress.map((p) => p.preflop) },
                { name: t.postflopSeries, color: SERIES_2, values: report.progress.map((p) => p.postflop) },
              ]}
            />
            <h4 className="sub-title">{fmt(t.evLossChart, { n: bucket })}</h4>
            <BarChart
              title={fmt(t.evLossChart, { n: bucket })}
              name={t.evLossSeries}
              labels={progressLabels}
              values={report.progress.map((p) => p.evLossPer100)}
              color={SERIES_2}
              format={(v) => v.toFixed(v >= 10 ? 0 : 1)}
            />
            <button className="link-button" onClick={() => setTable(!table)}>
              {t.showTable}
            </button>
            {table && (
              <table className="stat-table">
                <thead>
                  <tr>
                    <th />
                    <th>{t.preflopSeries}</th>
                    <th>{t.postflopSeries}</th>
                    <th>{t.evLossSeries}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.progress.map((p, i) => (
                    <tr key={i}>
                      <td className="stat-name">{progressLabels[i]}</td>
                      <td>{pct(p.preflop)}</td>
                      <td>{pct(p.postflop)}</td>
                      <td>{p.evLossPer100.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {!sessionOnly && report.sessions.length > 1 && (
        <section className="panel">
          <h3 className="panel-title">{t.sessionsTitle}</h3>
          <table className="stat-table">
            <thead>
              <tr>
                {(['date', 'hands', 'net', 'evNet', 'preflop', 'postflop'] as const).map((c) => (
                  <th key={c}>{t.sessionCols[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.sessions.map((r) => (
                <tr key={r.id}>
                  <td className="stat-name">{new Date(r.start).toLocaleString()}</td>
                  <td>{r.hands}</td>
                  <td>{formatSigned(r.net, settings)}</td>
                  <td>{formatSigned(r.evNet, settings)}</td>
                  <td>{pct(r.preflop)}</td>
                  <td>{pct(r.postflop)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function worstVerdict(h: StoredHand): string | null {
  const order = ['blunder', 'mistake', 'inaccuracy'];
  const all = [...h.preflopGrades.map((g) => g.verdict), ...(h.postflopGrades ?? []).map((g) => g.verdict)];
  for (const v of order) if (all.includes(v as never)) return v;
  return null;
}

function HandsView({ hands }: { hands: StoredHand[] }) {
  const settings = useGame((s) => s.settings);
  const replayRecord = useGame((s) => s.replayRecord);
  const openReview = useReviewUi((s) => s.open);
  const setView = useNav((s) => s.setView);
  const t = messages.records;
  const [filter, setFilter] = useState<'all' | 'mistakes' | 'big'>('all');
  const shown = hands
    .filter((h) => (filter === 'mistakes' ? worstVerdict(h) !== null : filter === 'big' ? Math.abs(h.heroNet) >= 30 * UNITS_PER_BB : true))
    .slice(0, 200);
  return (
    <section className="panel">
      <div className="filter-row">
        {(['all', 'mistakes', 'big'] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'chip-on' : ''}`} onClick={() => setFilter(f)}>
            {t.handsFilter[f]}
          </button>
        ))}
        <span className="settings-note">{fmt(t.showing, { n: shown.length })}</span>
      </div>
      {shown.length === 0 ? (
        <p className="panel-empty">{t.empty}</p>
      ) : (
        <ul className="review-items">
          {shown.map((h) => {
            const hero = h.record.holeCards[h.heroIndex]!;
            const worst = worstVerdict(h);
            let position = '';
            try {
              position = replayHand(h.record, 0).players[h.heroIndex]!.position;
            } catch {
              position = '';
            }
            return (
              <li key={h.id} className="review-item">
                <span className="mini-cards">
                  {hero.map((c) => (
                    <CardView key={c} card={c} fourColor={settings.fourColor} size="sm" />
                  ))}
                </span>
                <span className="review-item-main">
                  <strong>
                    {position} {hero.map(cardText).join(' ')}
                    {worst && <span className={`badge badge-${worst} step-badge`}>{messages.verdict[worst]}</span>}
                  </strong>
                  <span className="settings-note">{new Date(h.time).toLocaleString()}</span>
                </span>
                <span className={h.heroNet > 0 ? 'amount-win' : h.heroNet < 0 ? 'amount-lose' : 'amount-even'}>{formatSigned(h.heroNet, settings)}</span>
                <span className="button-row review-item-buttons">
                  <button
                    className="btn btn-plain btn-small"
                    onClick={() => {
                      const review = reviewFromRecord(h.record, h.profiles ?? [], h.heroIndex);
                      if (!review) return;
                      openReview(review, 'analyze');
                      setView('review');
                    }}
                  >
                    {t.replay}
                  </button>
                  <button
                    className="btn btn-plain btn-small"
                    onClick={() => {
                      replayRecord(h.record, h.profiles ?? h.record.seats.map(() => 'population'));
                      setView('table');
                    }}
                  >
                    {t.playAgain}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MistakeQuiz({ item, onAnswer }: { item: MistakeItem; onAnswer(correct: boolean): void }) {
  const settings = useGame((s) => s.settings);
  const t = messages.records;
  const [picked, setPicked] = useState<number | PreflopChoice | null>(null);
  const actionIndex = item.preflop?.actionIndex ?? item.postflop!.actionIndex;
  const hand = useMemo(() => replayHand(item.hand.record, actionIndex), [item, actionIndex]);
  const heroIndex = item.hand.heroIndex;
  const profiles = item.hand.profiles ?? [];
  const correct =
    picked === null ? null : item.preflop ? preflopAnswerOk(item.preflop, picked as PreflopChoice) : postflopAnswerOk(item.postflop!, picked as number);

  const choose = (p: number | PreflopChoice) => {
    if (picked !== null) return;
    setPicked(p);
    const ok = item.preflop ? preflopAnswerOk(item.preflop, p as PreflopChoice) : postflopAnswerOk(item.postflop!, p as number);
    onAnswer(ok);
  };

  return (
    <div className="mistake">
      <div className="review-table">
        <TableCanvas
          hand={hand}
          heroIndex={heroIndex}
          seatCount={hand.players.length}
          revealCount={hand.board.length}
          over={false}
          showTurn
          seats={hand.players.map((p, i) => ({ name: p.name, profile: profiles[i] ?? 'population' }))}
          settings={settings}
        />
      </div>
      <p className="step-text">{item.preflop ? scenarioText(item.preflop) : t.question}</p>
      <div className="quiz-choices">
        {item.preflop
          ? (['fold', 'call', 'raise'] as PreflopChoice[]).map((c) => (
              <button key={c} className={`btn btn-plain quiz-choice ${picked === c ? (correct ? 'quiz-right' : 'quiz-wrong') : ''}`} disabled={picked !== null} onClick={() => choose(c)}>
                {c === 'call' && item.preflop!.canCheck ? messages.choice.check : messages.choice[c]}
              </button>
            ))
          : item.postflop!.values.map((v, i) => (
              <button key={i} className={`btn btn-plain quiz-choice ${picked === i ? (correct ? 'quiz-right' : 'quiz-wrong') : ''}`} disabled={picked !== null} onClick={() => choose(i)}>
                {v.action.type === 'call'
                  ? `${messages.action.call} ${formatAmount(item.postflop!.toCall, settings)}`
                  : v.action.type === 'bet' || v.action.type === 'raise'
                    ? `${v.action.type === 'bet' ? messages.action.bet : messages.action.raiseTo} ${formatAmount(v.action.amount ?? 0, settings)}`
                    : messages.action[v.action.type]}
              </button>
            ))}
      </div>
      {picked !== null && (
        <div className="mistake-result">
          <p className={correct ? 'amount-win' : 'amount-lose'}>{correct ? t.right : t.wrong}</p>
          {item.preflop ? <GradeCard grade={item.preflop} settings={settings} /> : <PostflopCard grade={item.postflop!} settings={settings} />}
        </div>
      )}
    </div>
  );
}

function MistakesView({ hands }: { hands: StoredHand[] }) {
  const t = messages.records;
  const items = useMemo(() => collectMistakes(hands), [hands]);
  const [schedule, setSchedule] = useState(loadSchedule);
  const [queue, setQueue] = useState<MistakeItem[] | null>(null);
  const [answered, setAnswered] = useState(false);
  const due = items.filter((i) => isDue(i, schedule, Date.now()));

  if (queue && queue.length > 0) {
    const item = queue[0]!;
    return (
      <section className="panel">
        <MistakeQuiz
          key={item.key}
          item={item}
          onAnswer={(ok) => {
            const next = { ...schedule, [item.key]: nextSchedule(schedule[item.key], ok, Date.now()) };
            setSchedule(next);
            saveSchedule(next);
            setAnswered(true);
          }}
        />
        <div className="button-row">
          <button
            className="btn btn-primary"
            disabled={!answered}
            onClick={() => {
              setAnswered(false);
              setQueue(queue.slice(1));
            }}
          >
            {queue.length > 1 ? t.next : t.finish}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <p className="settings-note">{t.mistakesIntro}</p>
      <p>{due.length > 0 ? fmt(t.due, { n: due.length, total: items.length }) : t.noneDue}</p>
      <button className="btn btn-primary" disabled={due.length === 0} onClick={() => setQueue(due.slice(0, 20))}>
        {t.start}
      </button>
    </section>
  );
}

function BackupView({ count, onImported }: { count: number; onImported(): void }) {
  const t = messages.records;
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="panel">
      <p className="settings-note">{t.backupIntro}</p>
      <p>{fmt(t.storedCount, { n: count })}</p>
      <div className="button-row">
        <button className="btn btn-primary" onClick={() => void exportBackup().then((text) => download(`poker-practice-backup-${new Date().toISOString().slice(0, 10)}.json`, text))}>
          {t.exportBackup}
        </button>
        <button className="btn btn-plain" onClick={() => fileRef.current?.click()}>
          {t.importBackup}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void file
              .text()
              .then(importBackup)
              .then((r) => {
                setMessage(fmt(t.imported, { hands: r.hands, reviews: r.reviews, settings: r.settings }));
                onImported();
              })
              .catch(() => setMessage(t.importFailed));
          }}
        />
      </div>
      {message && <p className="form-message">{message}</p>}
    </section>
  );
}

export function RecordsScreen() {
  const t = messages.records;
  const [tab, setTab] = useState<Tab>('report');
  const [sessionOnly, setSessionOnly] = useState(false);
  const [hands, setHands] = useState<StoredHand[]>([]);
  const [version, setVersion] = useState(0);
  const stored = useGame((s) => s.storedHands);
  useEffect(() => {
    void listHands(5000).then(setHands);
  }, [version, stored]);
  return (
    <main className="screen">
      <div className="screen-body records">
        <div className="tabs tabs-inline" role="tablist">
          {(['report', 'hands', 'mistakes', 'backup'] as Tab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className={`tab ${tab === x ? 'tab-active' : ''}`} onClick={() => setTab(x)}>
              {t.tabs[x]}
            </button>
          ))}
          {tab === 'report' && (
            <span className="tab-tools">
              {([false, true] as const).map((v) => (
                <button key={String(v)} className={`chip ${sessionOnly === v ? 'chip-on' : ''}`} onClick={() => setSessionOnly(v)}>
                  {v ? t.scopeSession : t.scopeAll}
                </button>
              ))}
            </span>
          )}
        </div>
        {tab === 'report' && <ReportView hands={hands} sessionOnly={sessionOnly} />}
        {tab === 'hands' && <HandsView hands={hands} />}
        {tab === 'mistakes' && <MistakesView hands={hands} />}
        {tab === 'backup' && <BackupView count={hands.length} onImported={() => setVersion((v) => v + 1)} />}
      </div>
    </main>
  );
}

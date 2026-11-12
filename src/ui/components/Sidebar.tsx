import { useEffect, useRef, useState } from 'react';
import type { HandState } from '../../engine/types';
import { fmt, messages } from '../../i18n';
import { useGame, type HistoryEntry } from '../../store/gameStore';
import type { Settings } from '../../store/settings';
import { describeEvent } from '../format';
import { EntryGrades, FeedbackPanel, HandSummary } from './Feedback';
import { OpponentsPanel } from './OpponentsPanel';

type Tab = 'feedback' | 'log' | 'history' | 'opponents';

/** Hand history lines. While a hand is in progress, nothing beyond what is on screen is shown. */
interface LogLine {
  text: string;
  /** True for the line that announces a new street. */
  street: boolean;
}

function logLines(hand: HandState, settings: Settings, revealCount: number, complete: boolean): LogLine[] {
  const lines: LogLine[] = [];
  let shown = 0;
  for (const e of hand.events) {
    if (e.kind === 'deal') {
      if (!complete && shown + e.cards.length > revealCount) break;
      shown += e.cards.length;
    }
    if (!complete && (e.kind === 'show' || e.kind === 'win' || e.kind === 'rake' || e.kind === 'uncalled')) continue;
    lines.push({ text: describeEvent(e, hand, settings), street: e.kind === 'deal' });
  }
  return lines;
}

function LogPanel() {
  const hand = useGame((s) => s.hand);
  const phase = useGame((s) => s.phase);
  const revealCount = useGame((s) => s.revealCount);
  const settings = useGame((s) => s.settings);
  const endRef = useRef<HTMLDivElement>(null);
  const lines = hand ? logLines(hand, settings, revealCount, phase === 'handOver') : [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length]);
  if (!hand) return <p className="panel-empty">{messages.log.empty}</p>;
  return (
    <div className="log">
      <h3 className="panel-title">
        {messages.log.title}
        {messages.symbols.separator}
        {fmt(messages.log.handNumber, { n: hand.handId })}
      </h3>
      {lines.map((line, i) => (
        <div key={i} className={line.street ? 'log-line log-street' : 'log-line'}>
          {line.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function HistoryRow({ entry, settings }: { entry: HistoryEntry; settings: Settings }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="history-row">
      <button className="history-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <HandSummary entry={entry} settings={settings} />
      </button>
      {open && (
        <div className="history-body">
          <EntryGrades entry={entry} settings={settings} />
          {logLines(entry.hand, settings, 5, true).map((line, i) => (
            <div key={i} className={line.street ? 'log-line log-street' : 'log-line'}>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryPanel() {
  const history = useGame((s) => s.history);
  const settings = useGame((s) => s.settings);
  if (history.length === 0) return <p className="panel-empty">{messages.history.empty}</p>;
  return (
    <div className="history">
      {history.map((entry) => (
        <HistoryRow key={entry.key} entry={entry} settings={settings} />
      ))}
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('feedback');
  const tabs: Tab[] = ['feedback', 'log', 'history', 'opponents'];
  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'tab-active' : ''}`} onClick={() => setTab(t)}>
              {messages.tabs[t]}
            </button>
          ))}
          <button className="icon-button sidebar-close" onClick={onClose} aria-label={messages.chart.close}>
            {messages.symbols.close}
          </button>
        </div>
        <div className="sidebar-body">
          {tab === 'feedback' && <FeedbackPanel />}
          {tab === 'log' && <LogPanel />}
          {tab === 'history' && <HistoryPanel />}
          {tab === 'opponents' && <OpponentsPanel />}
        </div>
      </aside>
    </>
  );
}

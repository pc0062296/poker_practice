import { useEffect, useState } from 'react';
import { fmt, messages } from '../../i18n';
import { useGame } from '../../store/gameStore';
import { UNITS_PER_BB } from '../../store/settings';
import { ActionPanel } from '../components/ActionPanel';
import { Sidebar } from '../components/Sidebar';
import { TableView } from '../components/TableView';
import { formatAmount, formatSigned } from '../format';

function StatsStrip({ onSidebar }: { onSidebar: () => void }) {
  const stats = useGame((s) => s.stats);
  const settings = useGame((s) => s.settings);
  const t = messages.stats;
  const winRate = stats.hands > 0 ? (stats.net / UNITS_PER_BB / stats.hands) * 100 : null;
  const accuracy = stats.graded > 0 ? Math.round((stats.good / stats.graded) * 100) : null;
  const postflopAccuracy = stats.postflopGraded > 0 ? Math.round((stats.postflopGood / stats.postflopGraded) * 100) : null;
  const evLoss = stats.hands > 0 && stats.postflopGraded > 0 ? (stats.evLoss / UNITS_PER_BB / stats.hands) * 100 : null;
  const items: { label: string; value: string; className?: string; wide?: boolean }[] = [
    { label: t.hands, value: String(stats.hands) },
    {
      label: t.net,
      value: stats.hands > 0 ? formatSigned(stats.net, settings) : t.none,
      className: stats.net > 0 ? 'amount-win' : stats.net < 0 ? 'amount-lose' : '',
    },
    { label: t.winRate, value: winRate === null ? t.none : winRate.toFixed(1), wide: true },
    { label: t.preflop, value: accuracy === null ? t.none : `${accuracy}%` },
    { label: t.postflop, value: postflopAccuracy === null ? t.none : `${postflopAccuracy}%` },
    { label: t.evLoss, value: evLoss === null ? t.none : evLoss.toFixed(1), wide: true },
  ];
  return (
    <div className="stats-strip">
      {items.map((item) => (
        <div key={item.label} className={`strip-stat ${item.wide ? 'stat-wide' : ''}`}>
          <span className="stat-label">{item.label}</span>
          <span className={`stat-value ${item.className ?? ''}`}>{item.value}</span>
        </div>
      ))}
      <button className="btn btn-plain btn-small sidebar-toggle" onClick={onSidebar}>
        {messages.tabs.feedback}
      </button>
    </div>
  );
}

function Welcome({ onSettings }: { onSettings: () => void }) {
  const start = useGame((s) => s.start);
  const settings = useGame((s) => s.settings);
  const w = messages.welcome;
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark" aria-hidden="true">
          {messages.symbols.welcomeMark}
        </div>
        <h1>{messages.appName}</h1>
        <p className="welcome-tagline">{messages.appTagline}</p>
        <p>{w.intro}</p>
        <ul>
          {w.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="welcome-summary">
          {fmt(w.summary, {
            n: settings.numPlayers,
            sb: formatAmount(UNITS_PER_BB / 2, settings),
            bb: formatAmount(UNITS_PER_BB, settings),
            buyIn: formatAmount(settings.heroBuyInBB * UNITS_PER_BB, settings, true),
          })}
        </p>
        <div className="welcome-actions">
          <button className="btn btn-plain" onClick={onSettings}>
            {messages.settings.title}
          </button>
          <button className="btn btn-primary btn-large" onClick={start}>
            {messages.action.start}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastView() {
  const toast = useGame((s) => s.toast);
  const settings = useGame((s) => s.settings);
  const dismiss = useGame((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(dismiss, 2600);
    return () => clearTimeout(id);
  }, [toast, dismiss]);
  if (!toast) return null;
  const t = messages.toast;
  const net =
    toast.heroNet > 0
      ? fmt(t.netWin, { amount: formatAmount(toast.heroNet, settings, true) })
      : toast.heroNet < 0
        ? fmt(t.netLose, { amount: formatAmount(-toast.heroNet, settings, true) })
        : t.netEven;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span className="toast-title">{t.lastHand}</span>
      <span>{net}</span>
      {toast.verdict && <span className={`badge badge-${toast.verdict}`}>{messages.verdict[toast.verdict]}</span>}
    </div>
  );
}

function NoticeView() {
  const notice = useGame((s) => s.notice);
  const dismiss = useGame((s) => s.dismissNotice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(dismiss, 4000);
    return () => clearTimeout(id);
  }, [notice, dismiss]);
  if (!notice) return null;
  return (
    <div className="toast notice" role="status" key={notice.id}>
      {notice.text}
    </div>
  );
}

export function TableScreen({ onSettings }: { onSettings: () => void }) {
  const phase = useGame((s) => s.phase);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <main className="main">
      <section className="play">
        <StatsStrip onSidebar={() => setSidebarOpen(true)} />
        <TableView />
        <ToastView />
        <NoticeView />
        {phase === 'welcome' && <Welcome onSettings={onSettings} />}
        <ActionPanel />
      </section>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </main>
  );
}

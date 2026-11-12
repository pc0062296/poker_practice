import { useEffect, useState } from 'react';
import { fmt, messages } from './i18n';
import { useGame } from './store/gameStore';
import { UNITS_PER_BB } from './store/settings';
import { ActionPanel } from './ui/components/ActionPanel';
import { SettingsDialog } from './ui/components/SettingsDialog';
import { Sidebar } from './ui/components/Sidebar';
import { TableView } from './ui/components/TableView';
import { formatAmount, formatSigned } from './ui/format';

function TopBar({ onSettings, onSidebar }: { onSettings: () => void; onSidebar: () => void }) {
  const stats = useGame((s) => s.stats);
  const settings = useGame((s) => s.settings);
  const t = messages.stats;
  const winRate = stats.hands > 0 ? (stats.net / UNITS_PER_BB / stats.hands) * 100 : null;
  const accuracy = stats.graded > 0 ? Math.round((stats.good / stats.graded) * 100) : null;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          {messages.symbols.brandMark}
        </span>
        <span className="brand-name">{messages.appName}</span>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">{t.hands}</span>
          <span className="stat-value">{stats.hands}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.net}</span>
          <span className={`stat-value ${stats.net > 0 ? 'amount-win' : stats.net < 0 ? 'amount-lose' : ''}`}>
            {stats.hands > 0 ? formatSigned(stats.net, settings) : t.none}
          </span>
        </div>
        <div className="stat stat-wide">
          <span className="stat-label">{t.winRate}</span>
          <span className="stat-value">{winRate === null ? t.none : winRate.toFixed(1)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.preflop}</span>
          <span className="stat-value">{accuracy === null ? t.none : `${accuracy}%`}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="btn btn-plain sidebar-toggle" onClick={onSidebar}>
          {messages.tabs.feedback}
        </button>
        <button className="btn btn-plain" onClick={onSettings}>
          {messages.settings.title}
        </button>
      </div>
    </header>
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

export function App() {
  const phase = useGame((s) => s.phase);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="app">
      <TopBar onSettings={() => setSettingsOpen(true)} onSidebar={() => setSidebarOpen(true)} />
      <main className="main">
        <section className="play">
          <TableView />
          <ToastView />
          {phase === 'welcome' && <Welcome onSettings={() => setSettingsOpen(true)} />}
          <ActionPanel />
        </section>
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

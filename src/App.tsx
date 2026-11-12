import { useState } from 'react';
import { messages } from './i18n';
import { useNav, VIEWS, type View } from './store/nav';
import { SettingsDialog } from './ui/components/SettingsDialog';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { DrillScreen } from './ui/screens/DrillScreen';
import { RangesScreen } from './ui/screens/RangesScreen';
import { RecordsScreen } from './ui/screens/RecordsScreen';
import { ReviewScreen } from './ui/screens/ReviewScreen';
import { TableScreen } from './ui/screens/TableScreen';
import { ToolsScreen } from './ui/screens/ToolsScreen';

/** Screens that exist so far; the others appear as they are built. */
const READY: View[] = ['table', 'drill', 'ranges', 'tools', 'review', 'records'];

function TopBar({ onSettings }: { onSettings: () => void }) {
  const view = useNav((s) => s.view);
  const setView = useNav((s) => s.setView);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          {messages.symbols.brandMark}
        </span>
        <span className="brand-name">{messages.appName}</span>
      </div>
      <nav className="nav" aria-label={messages.nav.label}>
        {VIEWS.filter((v) => READY.includes(v)).map((v) => (
          <button key={v} className={`nav-item ${view === v ? 'nav-active' : ''}`} onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}>
            {messages.nav[v]}
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <button className="btn btn-plain" onClick={onSettings}>
          {messages.settings.title}
        </button>
      </div>
    </header>
  );
}

export function App() {
  const view = useNav((s) => s.view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => setSettingsOpen(true);
  return (
    <div className="app">
      <TopBar onSettings={openSettings} />
      <ErrorBoundary resetKey={view}>
        {view === 'table' && <TableScreen onSettings={openSettings} />}
        {view === 'drill' && <DrillScreen />}
        {view === 'ranges' && <RangesScreen />}
        {view === 'tools' && <ToolsScreen />}
        {view === 'review' && <ReviewScreen />}
        {view === 'records' && <RecordsScreen />}
      </ErrorBoundary>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

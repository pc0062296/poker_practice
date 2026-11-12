import { useState } from 'react';
import { CLASS_LABELS } from '../../eval/handClass';
import type { PreflopChoice, PreflopGrade } from '../../grading/preflop';
import { fmt, messages } from '../../i18n';
import { getChart } from '../../ranges/charts';
import { HERO, useGame, type HistoryEntry } from '../../store/gameStore';
import type { Settings } from '../../store/settings';
import { cardText, formatAmount, formatSigned } from '../format';
import { Modal } from './Modal';
import { RangeGrid } from './RangeGrid';

/** Describe the preflop spot in words. */
export function scenarioText(grade: PreflopGrade): string {
  return fmt(messages.scenario[grade.kind], {
    pos: grade.heroPosition,
    villain: grade.villainPosition ?? '',
  });
}

function choiceLabel(choice: PreflopChoice, grade: PreflopGrade): string {
  if (choice === 'call' && grade.canCheck) return messages.choice.check;
  return messages.choice[choice];
}

export function GradeCard({ grade, settings }: { grade: PreflopGrade; settings: Settings }) {
  const [open, setOpen] = useState(false);
  const chart = grade.chartKey ? getChart(grade.chartKey, grade.depth) : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const order: PreflopChoice[] = ['raise', 'call', 'fold'];
  return (
    <div className={`grade grade-${grade.verdict}`}>
      <div className="grade-head">
        <span className="grade-scenario">{scenarioText(grade)}</span>
        <span className={`badge badge-${grade.verdict}`}>{messages.verdict[grade.verdict]}</span>
      </div>
      {grade.verdict === 'ungraded' ? (
        <p className="grade-note">{messages.feedback.ungraded}</p>
      ) : (
        <>
          <div className="freq-bar" aria-hidden="true">
            {order.map((c) =>
              grade.freq[c] > 0.005 ? (
                <div key={c} className={`freq freq-${c}`} style={{ flexGrow: grade.freq[c] }} />
              ) : null,
            )}
          </div>
          <div className="freq-text">
            <span className="freq-title">{messages.feedback.chartSays}</span>
            {order.map((c) =>
              grade.freq[c] > 0.005 ? (
                <span key={c} className={`freq-item ${c === grade.chosen ? 'freq-item-chosen' : ''}`}>
                  {choiceLabel(c, grade)} {pct(grade.freq[c])}
                </span>
              ) : null,
            )}
          </div>
        </>
      )}
      <div className="grade-choice">
        {messages.feedback.youChose}
        {messages.symbols.colon}
        <strong>{choiceLabel(grade.chosen, grade)}</strong>
      </div>
      {grade.sizing && grade.sizing.verdict !== 'ok' && (
        <p className="grade-note">
          {fmt(grade.sizing.verdict === 'small' ? messages.feedback.sizingSmall : messages.feedback.sizingLarge, {
            standard: formatAmount(grade.sizing.standard, settings, true),
            hero: formatAmount(grade.sizing.hero, settings, true),
          })}
        </p>
      )}
      {grade.approx && grade.verdict !== 'ungraded' && <p className="grade-note">{messages.feedback.approx}</p>}
      {chart && (
        <button className="link-button" onClick={() => setOpen(true)}>
          {messages.feedback.viewChart}
        </button>
      )}
      {open && chart && (
        <Modal title={`${messages.chart.title}${messages.symbols.colon}${scenarioText(grade)}`} onClose={() => setOpen(false)}>
          <p className="modal-sub">
            {fmt(messages.scenario.depth, { depth: grade.depth })}
            {messages.symbols.separator}
            {CLASS_LABELS[grade.handClass]}
          </p>
          <RangeGrid chart={chart} highlight={grade.handClass} />
          <p className="modal-note">{messages.feedback.note}</p>
        </Modal>
      )}
    </div>
  );
}

export function HandSummary({ entry, settings }: { entry: HistoryEntry; settings: Settings }) {
  const hero = entry.hand.players[HERO]!;
  return (
    <div className="hand-summary">
      <span className="hand-number">{fmt(messages.log.handNumber, { n: entry.id })}</span>
      <span className="hand-cards">{hero.hole.map(cardText).join(' ')}</span>
      <span className="hand-pos">{hero.position}</span>
      <span className={entry.heroNet > 0 ? 'amount-win' : entry.heroNet < 0 ? 'amount-lose' : 'amount-even'}>
        {formatSigned(entry.heroNet, settings)}
      </span>
    </div>
  );
}

/** Preflop grades for the most recently finished hand. */
export function FeedbackPanel() {
  const last = useGame((s) => s.lastHand);
  const settings = useGame((s) => s.settings);
  if (!last) return <p className="panel-empty">{messages.feedback.empty}</p>;
  return (
    <div className="feedback">
      <h3 className="panel-title">{messages.feedback.title}</h3>
      <HandSummary entry={last} settings={settings} />
      {last.grades.length === 0 ? (
        <p className="panel-empty">{messages.feedback.noDecision}</p>
      ) : (
        last.grades.map((g, i) => <GradeCard key={i} grade={g} settings={settings} />)
      )}
    </div>
  );
}

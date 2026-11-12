import { useState } from 'react';
import type { Action } from '../../engine/types';
import type { PostflopGrade } from '../../grading/postflop';
import { fmt, messages } from '../../i18n';
import type { Settings } from '../../store/settings';
import { cardText, formatAmount } from '../format';
import { Modal } from './Modal';
import { RangeHeat } from './RangeHeat';

function actionLabel(action: Action, toCall: number, settings: Settings): string {
  const a = messages.action;
  switch (action.type) {
    case 'fold':
      return a.fold;
    case 'check':
      return a.check;
    case 'call':
      return `${a.call} ${formatAmount(toCall, settings)}`;
    case 'bet':
      return `${a.bet} ${formatAmount(action.amount ?? 0, settings)}`;
    default:
      return `${a.raiseTo} ${formatAmount(action.amount ?? 0, settings)}`;
  }
}

function signedBB(chips: number, settings: Settings): string {
  const text = formatAmount(Math.abs(chips), settings);
  return chips > 0.5 ? `+${text}` : chips < -0.5 ? `${messages.symbols.minus}${text}` : text;
}

const pct = (x: number) => Math.round(x * 100);

export function PostflopCard({ grade, settings }: { grade: PostflopGrade; settings: Settings }) {
  const [open, setOpen] = useState(false);
  const t = messages.postflop;
  const street = messages.street[grade.street];
  const title = fmt(t.situation[grade.situation]!, { street, amount: formatAmount(grade.toCall, settings, true) });
  const order = grade.values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v.ev - a.v.ev);
  const maxSe = Math.max(...grade.values.map((v) => v.se));
  const kinds: ('aggressive' | 'passive' | 'fold')[] = ['aggressive', 'passive', 'fold'];
  const villain = grade.villain;

  return (
    <div className={`grade grade-${grade.verdict}`}>
      <div className="grade-head">
        <span className="grade-scenario">
          {title}
          <span className="grade-board">{grade.board.map(cardText).join(' ')}</span>
        </span>
        <span className={`badge badge-${grade.verdict}`}>{messages.verdict[grade.verdict]}</span>
      </div>

      <table className="ev-table">
        <thead>
          <tr>
            <th>{t.evTitle}</th>
            <th>EV</th>
          </tr>
        </thead>
        <tbody>
          {order.map(({ v, i }) => (
            <tr key={i} className={i === grade.chosenIndex ? 'ev-chosen' : ''}>
              <td>
                {actionLabel(v.action, grade.toCall, settings)}
                {i === grade.bestIndex && <span className="ev-tag ev-tag-best">{t.best}</span>}
                {i === grade.chosenIndex && <span className="ev-tag">{t.you}</span>}
              </td>
              <td className="ev-value">{signedBB(v.ev, settings)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="grade-line">
        {grade.loss > 0.5
          ? fmt(t.loss, { amount: formatAmount(grade.loss, settings, true) })
          : t.noLoss}
        {grade.uncertain && <span className="grade-note-inline">{t.uncertain}</span>}
      </p>
      <p className="grade-note">
        {grade.exact ? t.exact : fmt(t.estimate, { se: formatAmount(maxSe, settings, true) })}
        {grade.checkdown && `${messages.symbols.separator}${t.checkdown}`}
      </p>

      <div className="freq-bar" aria-hidden="true">
        {kinds.map((k) =>
          grade.baseline[k] > 0.005 ? (
            <div key={k} className={`freq freq-${k === 'aggressive' ? 'raise' : k === 'passive' ? 'call' : 'fold'}`} style={{ flexGrow: grade.baseline[k] }} />
          ) : null,
        )}
      </div>
      <div className="freq-text">
        <span className="freq-title">{t.baseline}</span>
        {kinds.map((k) =>
          grade.baseline[k] > 0.005 ? (
            <span key={k} className={`freq-item ${k === grade.chosenKind ? 'freq-item-chosen' : ''}`}>
              {t.kinds[k]} {pct(grade.baseline[k])}%
            </span>
          ) : null,
        )}
      </div>

      <div className="facts">
        <span>{fmt(t.facts, { pot: formatAmount(grade.pot, settings, true), spr: grade.spr.toFixed(1) })}</span>
        <span>{fmt(t.equity, { x: pct(grade.equity) })}</span>
        {grade.potOdds !== null && <span>{fmt(t.potOdds, { x: pct(grade.potOdds) })}</span>}
        {grade.mdf !== null && <span>{fmt(t.mdf, { x: pct(grade.mdf) })}</span>}
      </div>

      {villain && (
        <div className="villain">
          <div className="villain-head">
            {villain.name === villain.position ? fmt(t.villainPos, { pos: villain.position }) : fmt(t.villain, { name: villain.name, pos: villain.position })}
            <em className={`seat-type type-${villain.profile}`}>{messages.profile[villain.profile]}</em>
          </div>
          <div className="mix-bar">
            {(['strong', 'medium', 'draw', 'weak'] as const).map((k) =>
              villain.mix[k] > 0.005 ? <div key={k} className={`mix mix-${k}`} style={{ flexGrow: villain.mix[k] }} /> : null,
            )}
          </div>
          <div className="mix-text">
            {(['strong', 'medium', 'draw', 'weak'] as const).map((k) => (
              <span key={k}>
                <i className={`swatch mix-${k}`} />
                {t.mix[k]} {pct(villain.mix[k])}%
              </span>
            ))}
          </div>
          <button className="link-button" onClick={() => setOpen(true)}>
            {t.viewRange}
          </button>
        </div>
      )}
      <p className="grade-note">{grade.model === 'actual' ? t.modelActual : t.modelObserver}</p>

      {open && villain && (
        <Modal
          title={villain.name === villain.position ? fmt(t.rangeTitlePos, { pos: villain.position }) : fmt(t.rangeTitle, { name: villain.name, pos: villain.position })}
          onClose={() => setOpen(false)}
        >
          <p className="modal-sub">
            {street} {grade.board.map(cardText).join(' ')}
          </p>
          <RangeHeat classes={villain.classes} />
          <p className="modal-note">{t.rangeNote}</p>
        </Modal>
      )}
    </div>
  );
}

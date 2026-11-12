import { useMemo, useState } from 'react';
import { SEAT_PROFILE_IDS } from '../../bots/profiles';
import type { Card } from '../../engine/cards';
import { getLegalActions, potTotal } from '../../engine/hand';
import { assignPositions } from '../../engine/positions';
import type { Action, PositionName } from '../../engine/types';
import { fmt, messages } from '../../i18n';
import { buildHand, isComplete, resizeReview, reviewPositions, type ReviewHand } from '../../review/model';
import { useGame } from '../../store/gameStore';
import { UNITS_PER_BB } from '../../store/settings';
import { CardPicker } from '../components/CardPicker';
import { CardView } from '../components/CardView';
import { Modal } from '../components/Modal';
import { TableCanvas } from '../components/TableView';
import { describeEvent, formatAmount } from '../format';
import { fromChips, toChips } from './amounts';

interface EditorProps {
  review: ReviewHand;
  onChange(review: ReviewHand): void;
  onSave(): void;
  onAnalyze(): void;
  onBack(): void;
  savedNote: string | null;
}

const STREET_NAMES = ['flop', 'turn', 'river'] as const;

export function ReviewEditor({ review, onChange, onSave, onAnalyze, onBack, savedNote }: EditorProps) {
  const settings = useGame((s) => s.settings);
  const t = messages.review;
  const [picking, setPicking] = useState<'hero' | 'board' | number | null>(null);
  const [boardDraft, setBoardDraft] = useState<Card[]>([]);
  const [amountText, setAmountText] = useState('');

  const positions = reviewPositions(review);
  const names = positions.map((p, i) => (i === 0 ? messages.heroName : p));
  const built = useMemo(() => buildHand(review, review.actions.length, names), [review]); // eslint-disable-line react-hooks/exhaustive-deps
  const hand = built.hand;
  const legal = built.needCards === 0 && !hand.isComplete ? getLegalActions(hand) : null;
  const complete = isComplete(review);
  const usedCards = new Set<Card>([...review.heroCards, ...review.board]);
  for (const s of review.shown) for (const c of s ?? []) usedCards.add(c);

  const patch = (p: Partial<ReviewHand>) => onChange({ ...review, ...p });
  const addAction = (action: Action) => {
    patch({ actions: [...review.actions, action] });
    setAmountText('');
  };

  const undo = () => {
    const k = review.actions.length;
    const before = k > 0 ? dealtAfter(review, k - 1) : 0;
    if (review.board.length > before) {
      // The last entry was community cards: remove the latest street.
      const prev = [0, 3, 4, 5].filter((x) => x < review.board.length).pop() ?? 0;
      patch({ board: review.board.slice(0, Math.max(prev, before)) });
      return;
    }
    if (k > 0) patch({ actions: review.actions.slice(0, -1), shown: review.shown.map(() => null) });
  };

  const raiseTo = (to: number) => {
    if (!legal || !legal.canRaise) return;
    const clamped = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(to)));
    addAction({ type: legal.raiseType, amount: clamped });
  };

  const pot = potTotal(hand);
  const presets: { label: string; to: number }[] = [];
  if (legal?.canRaise) {
    if (hand.street === 'preflop') {
      const level = hand.straddleIndex >= 0 ? hand.config.straddle : hand.config.bigBlind;
      const base = hand.currentBet <= level ? level : hand.currentBet;
      for (const m of [2.5, 3, 4]) presets.push({ label: `${m}x`, to: base * m });
    } else if (hand.currentBet === 0) {
      presets.push({ label: '1/3', to: pot / 3 }, { label: '1/2', to: pot / 2 }, { label: '2/3', to: (pot * 2) / 3 }, { label: messages.table.pot, to: pot });
    } else {
      for (const m of [2.5, 3]) presets.push({ label: `${m}x`, to: hand.currentBet * m });
    }
    presets.push({ label: messages.action.allIn, to: legal.maxRaiseTo });
  }

  const lines = hand.events
    .filter((e) => e.kind === 'action' || e.kind === 'deal')
    .map((e) => describeEvent(e, hand, settings).replace(/^\s+/, ''));
  const actorPos = legal ? positions[hand.toAct] : null;
  const typedAmount = Number(amountText);

  const posOptions = assignPositions(review.numPlayers, 0);
  const pickerSelected =
    picking === 'hero' ? review.heroCards : picking === 'board' ? boardDraft : typeof picking === 'number' ? (review.shown[picking] ?? []) : [];
  const pickerUsed = new Set<Card>([...usedCards].filter((c) => !pickerSelected.includes(c)));

  return (
    <div className="screen-body review-editor">
      <section className="panel">
        <div className="grade-head">
          <h2 className="panel-heading">{t.setup}</h2>
          <button className="link-button" onClick={onBack}>
            {t.back}
          </button>
        </div>
        <label className="text-field">
          <span>{t.titleField}</span>
          <input className="text-input text-input-wide" value={review.title} onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <div className="field">
          <span className="field-label">{t.players}</span>
          <div className="segmented">
            {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} type="button" className={`segment ${review.numPlayers === n ? 'segment-active' : ''}`} onClick={() => onChange(resizeReview(review, n))}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">{t.heroPosition}</span>
          <div className="segmented">
            {PREFLOP_DISPLAY.filter((p) => posOptions.includes(p)).map((p) => (
              <button key={p} type="button" className={`segment ${review.heroPosition === p ? 'segment-active' : ''}`} onClick={() => patch({ heroPosition: p, actions: [], board: [] })}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">{t.smallBlind}</span>
          <div className="segmented">
            {[UNITS_PER_BB / 2, UNITS_PER_BB].map((sb) => (
              <button key={sb} type="button" className={`segment ${review.smallBlind === sb ? 'segment-active' : ''}`} onClick={() => patch({ smallBlind: sb, actions: [], board: [] })}>
                {formatAmount(sb, settings, true)}
              </button>
            ))}
          </div>
          <span className="field-label">{t.straddle}</span>
          <div className="segmented">
            {[0, UNITS_PER_BB * 2].map((st) => (
              <button key={st} type="button" className={`segment ${review.straddle === st ? 'segment-active' : ''}`} onClick={() => patch({ straddle: st, actions: [], board: [] })}>
                {st === 0 ? t.noStraddle : formatAmount(st, settings, true)}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-note">{t.setupWarning}</p>

        <h3 className="panel-title">{t.stacks}</h3>
        <div className="stack-grid">
          {positions.map((pos, i) => (
            <div key={i} className="stack-row">
              <span className={`seat-pos ${i === 0 ? 'stack-hero' : ''}`}>{pos}</span>
              <input
                className="text-input stack-input"
                type="number"
                inputMode="decimal"
                value={fromChips(review.stacks[i]!, settings)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  const stacks = review.stacks.slice();
                  stacks[i] = Math.max(1, toChips(v, settings));
                  patch({ stacks });
                }}
              />
              {i === 0 ? (
                <span className="stack-you">{messages.heroName}</span>
              ) : (
                <select
                  className="select"
                  value={review.profiles[i]}
                  onChange={(e) => {
                    const profiles = review.profiles.slice();
                    profiles[i] = e.target.value;
                    patch({ profiles });
                  }}
                >
                  {SEAT_PROFILE_IDS.filter((p) => p !== 'custom').map((p) => (
                    <option key={p} value={p}>
                      {messages.profile[p]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>

        <div className="field">
          <span className="field-label">{t.heroCards}</span>
          <div className="equity-cards">
            <span className="mini-cards mini-cards-big">
              {review.heroCards.map((c) => (
                <CardView key={c} card={c} fourColor={settings.fourColor} size="sm" />
              ))}
            </span>
            <button className="btn btn-plain btn-small" onClick={() => setPicking('hero')}>
              {t.pick}
            </button>
          </div>
        </div>
        <label className="text-field">
          <span>{t.notes}</span>
          <textarea rows={2} value={review.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </label>
      </section>

      <section className="panel">
        <h2 className="panel-heading">{t.actionsTitle}</h2>
        <div className="review-table">
          <TableCanvas
            hand={hand}
            heroIndex={0}
            seatCount={review.numPlayers}
            revealCount={hand.board.length}
            over={false}
            showTurn={!!legal}
            seats={positions.map((_, i) => ({ name: names[i]!, profile: review.profiles[i] ?? 'population' }))}
            settings={settings}
            known={(i) => i === 0 || !!review.shown[i]}
            showTypes
          />
        </div>

        {review.heroCards.length < 2 ? (
          <p className="form-message">{t.missingHeroCards}</p>
        ) : built.error ? (
          <p className="form-message">{fmt(t.illegal, { error: built.error })}</p>
        ) : built.needCards > 0 ? (
          <div className="review-prompt">
            <p>
              {fmt(t.needCards, {
                street: messages.street[STREET_NAMES[review.board.length >= 4 ? 2 : review.board.length >= 3 ? 1 : 0]],
                n: built.needCards,
              })}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setBoardDraft([]);
                setPicking('board');
              }}
            >
              {t.pick}
            </button>
          </div>
        ) : legal ? (
          <div className="review-prompt">
            <p className="review-actor">{hand.toAct === 0 ? t.heroToAct : fmt(t.toAct, { pos: actorPos ?? '' })}</p>
            <div className="review-buttons">
              {!legal.canCheck && (
                <button className="btn btn-fold" onClick={() => addAction({ type: 'fold' })}>
                  {messages.action.fold}
                </button>
              )}
              <button className="btn btn-call" onClick={() => addAction({ type: legal.canCheck ? 'check' : 'call' })}>
                {legal.canCheck ? messages.action.check : `${messages.action.call} ${formatAmount(legal.callAmount, settings)}`}
              </button>
            </div>
            {legal.canRaise && (
              <>
                <div className="presets">
                  {presets.map((p) => (
                    <button key={p.label} className="preset" onClick={() => raiseTo(p.to)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="review-amount">
                  <input
                    className="text-input"
                    type="number"
                    inputMode="decimal"
                    placeholder={`${fromChips(legal.minRaiseTo, settings)}`}
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                  />
                  <button
                    className="btn btn-raise"
                    disabled={!Number.isFinite(typedAmount) || typedAmount <= 0}
                    onClick={() => raiseTo(toChips(typedAmount, settings))}
                  >
                    {legal.raiseType === 'bet' ? messages.action.betAmount : messages.action.raiseTo}
                    {amountText ? ` ${amountText}` : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="review-prompt">
            <p className="review-actor">{t.done}</p>
            {hand.result?.showdown && (
              <>
                <p className="settings-note">{t.showdownTitle}</p>
                <div className="button-row">
                  {hand.players.map((p, i) =>
                    i !== 0 && !p.folded ? (
                      <button key={i} className="btn btn-plain btn-small" onClick={() => setPicking(i)}>
                        {positions[i]} {t.showCards}
                        <span className="mini-cards">
                          {(review.shown[i] ?? []).map((c) => (
                            <CardView key={c} card={c} fourColor={settings.fourColor} size="sm" />
                          ))}
                        </span>
                      </button>
                    ) : null,
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="button-row">
          <button className="btn btn-plain" onClick={undo} disabled={review.actions.length === 0 && review.board.length === 0}>
            {t.undo}
          </button>
          <span className="spacer" />
          <button className="btn btn-plain" onClick={onSave}>
            {t.save}
          </button>
          <button className="btn btn-primary" onClick={onAnalyze} disabled={review.heroCards.length < 2 || review.actions.length === 0}>
            {t.analyzeHand}
          </button>
        </div>
        {savedNote && <p className="settings-note">{savedNote}</p>}
        {complete && <p className="settings-note">{t.done}</p>}
        <ol className="review-lines">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </section>

      {picking !== null && (
        <Modal
          title={picking === 'hero' ? t.heroCards : picking === 'board' ? messages.equity.board : `${positions[picking as number]} ${t.showCards}`}
          onClose={() => setPicking(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={picking === 'board' && boardDraft.length !== built.needCards}
              onClick={() => {
                if (picking === 'board') patch({ board: [...review.board, ...boardDraft] });
                setPicking(null);
              }}
            >
              {picking === 'board' ? t.confirmCards : messages.equity.done}
            </button>
          }
        >
          <CardPicker
            selected={pickerSelected}
            used={pickerUsed}
            max={picking === 'board' ? built.needCards : 2}
            fourColor={settings.fourColor}
            onChange={(cards) => {
              if (picking === 'hero') patch({ heroCards: cards, actions: cards.length === 2 ? review.actions : [] });
              else if (picking === 'board') setBoardDraft(cards);
              else {
                const shown = review.shown.slice();
                shown[picking] = cards.length === 2 ? cards : null;
                patch({ shown });
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

const PREFLOP_DISPLAY: PositionName[] = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** Community cards the engine deals after the first `count` actions, whatever was entered. */
function dealtAfter(review: ReviewHand, count: number): number {
  const full = buildHand(review, 0).hand.runout;
  return buildHand({ ...review, board: full }, count).hand.board.length;
}

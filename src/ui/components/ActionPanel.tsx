import { useEffect, useMemo, useState } from 'react';
import { potTotal } from '../../engine/hand';
import type { HandState, LegalActions } from '../../engine/types';
import { fmt, messages } from '../../i18n';
import { HERO, useGame } from '../../store/gameStore';
import { UNITS_PER_BB, type Settings } from '../../store/settings';
import { formatAmount, formatSigned } from '../format';

interface Preset {
  label: string;
  to: number;
}

const STEP = UNITS_PER_BB / 2;

function clampTo(value: number, legal: LegalActions): number {
  const rounded = Math.round(value / STEP) * STEP;
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, rounded));
}

/** Quick bet sizes for the current decision. */
function buildPresets(hand: HandState, legal: LegalActions): Preset[] {
  const pot = potTotal(hand);
  const current = hand.currentBet;
  const level = hand.straddleIndex >= 0 ? hand.config.straddle : hand.config.bigBlind;
  const raw: Preset[] = [];
  if (hand.street === 'preflop') {
    const base = current <= level ? level : current;
    const mults = current <= level ? [2.5, 3, 4, 5] : [2.5, 3, 3.5, 4];
    for (const m of mults) raw.push({ label: `${m}x`, to: base * m });
  } else if (current === 0) {
    raw.push({ label: '1/3', to: pot / 3 });
    raw.push({ label: '1/2', to: pot / 2 });
    raw.push({ label: '2/3', to: (pot * 2) / 3 });
    raw.push({ label: '3/4', to: (pot * 3) / 4 });
    raw.push({ label: messages.table.pot, to: pot });
  } else {
    for (const m of [2.5, 3, 4]) raw.push({ label: `${m}x`, to: current * m });
    raw.push({ label: messages.table.pot, to: current + pot + legal.callAmount });
  }
  const out: Preset[] = [];
  const seen = new Set<number>();
  for (const p of raw) {
    const to = clampTo(p.to, legal);
    if (to >= legal.maxRaiseTo || seen.has(to)) continue;
    seen.add(to);
    out.push({ label: p.label, to });
  }
  out.push({ label: messages.action.allIn, to: legal.maxRaiseTo });
  return out;
}

function toDisplay(units: number, settings: Settings): number {
  const bb = units / UNITS_PER_BB;
  return settings.unit === 'chips' ? Math.round(bb * settings.bigBlindAmount) : bb;
}

function fromDisplay(value: number, settings: Settings): number {
  const bb = settings.unit === 'chips' ? value / settings.bigBlindAmount : value;
  return bb * UNITS_PER_BB;
}

export function ActionPanel() {
  const hand = useGame((s) => s.hand);
  const legal = useGame((s) => s.legal);
  const phase = useGame((s) => s.phase);
  const revealCount = useGame((s) => s.revealCount);
  const settings = useGame((s) => s.settings);
  const heroAct = useGame((s) => s.heroAct);
  const nextHand = useGame((s) => s.nextHand);
  const potQuiz = useGame((s) => s.potQuiz);
  const answerPotQuiz = useGame((s) => s.answerPotQuiz);
  const [guessText, setGuessText] = useState('');

  const settled = hand ? revealCount >= hand.board.length : true;
  const deciding = phase === 'playing' && hand !== null && legal !== null && settled;
  const decisionKey = hand ? `${hand.handId}:${hand.events.length}` : '';
  const presets = useMemo(
    () => (deciding && legal!.canRaise ? buildPresets(hand!, legal!) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decisionKey, deciding],
  );

  const [raiseTo, setRaiseTo] = useState(0);
  const [draft, setDraft] = useState('');

  const setAmount = (to: number) => {
    if (!legal) return;
    const clamped = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(to)));
    setRaiseTo(clamped);
    setDraft(String(toDisplay(clamped, settings)));
  };

  // Start each decision from a sensible default size.
  useEffect(() => {
    if (!deciding || !legal!.canRaise) return;
    const pick = presets.length > 2 ? presets[1]! : presets[0]!;
    setAmount(pick.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, deciding]);

  const fold = () => deciding && !legal!.canCheck && heroAct({ type: 'fold' });
  const callOrCheck = () => deciding && heroAct({ type: legal!.canCheck ? 'check' : 'call' });
  const raise = () => deciding && legal!.canRaise && raiseTo > 0 && heroAct({ type: legal!.raiseType, amount: raiseTo });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
      if (typing && !(target!.classList.contains('amount-input') && e.key === 'Enter')) return;
      const key = e.key.toLowerCase();
      if (phase === 'handOver' && (key === ' ' || key === 'n' || key === 'enter')) {
        e.preventDefault();
        nextHand();
      } else if (key === 'f') fold();
      else if (key === 'c') callOrCheck();
      else if (key === 'r' || (typing && key === 'enter')) raise();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!hand || phase === 'welcome') return <div className="action-panel action-panel-empty" />;

  if (phase === 'handOver') {
    const net = hand.result?.net[HERO] ?? 0;
    return (
      <div className="action-panel">
        <div className="action-status">
          <span className={net > 0 ? 'amount-win' : net < 0 ? 'amount-lose' : ''}>{formatSigned(net, settings)}</span>
        </div>
        <div className="action-buttons">
          <button className="btn btn-next" onClick={nextHand}>
            {messages.action.nextHand}
            <kbd>{messages.keys.next}</kbd>
          </button>
        </div>
      </div>
    );
  }

  if (!deciding) {
    const hero = hand.players[HERO]!;
    let status: string;
    if (!settled || hand.isComplete || hand.toAct < 0) status = messages.table.runout;
    else if (hero.folded) status = messages.table.youFolded;
    else status = fmt(messages.table.waiting, { name: hand.players[hand.toAct]!.name });
    return (
      <div className="action-panel">
        <div className="action-status action-status-waiting">{status}</div>
      </div>
    );
  }

  if (potQuiz && potQuiz.guess === null) {
    const submit = () => {
      const v = Number(guessText);
      if (!Number.isFinite(v) || v <= 0) return;
      answerPotQuiz(Math.round(fromDisplay(v, settings)));
      setGuessText('');
    };
    return (
      <div className="action-panel">
        <div className="pot-quiz">
          <span className="pot-quiz-q">{messages.live.potQuestion}</span>
          <div className="slider-row">
            <input
              className="amount-input pot-quiz-input"
              type="number"
              inputMode="decimal"
              autoFocus
              value={guessText}
              onChange={(e) => setGuessText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <span className="amount-unit">{settings.unit === 'bb' ? 'BB' : ''}</span>
            <button className="btn btn-primary" onClick={submit}>
              {messages.live.answer}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hero = hand.players[HERO]!;
  const a = messages.action;
  const callLabel = legal!.canCheck
    ? a.check
    : `${legal!.callAmount >= hero.stack ? a.callAllIn : a.call} ${formatAmount(legal!.callAmount, settings)}`;
  const isAllIn = raiseTo >= legal!.maxRaiseTo;
  const raiseLabel = isAllIn
    ? `${a.allIn} ${formatAmount(raiseTo, settings)}`
    : `${legal!.raiseType === 'bet' ? a.betAmount : a.raiseTo} ${formatAmount(raiseTo, settings)}`;
  const sliderMax = Math.max(legal!.minRaiseTo, legal!.maxRaiseTo);

  const manual = settings.manualBet;
  return (
    <div className="action-panel">
      {potQuiz && potQuiz.guess !== null && (
        <div className={`pot-quiz-result ${potQuiz.correct ? 'amount-win' : 'amount-lose'}`}>
          {fmt(potQuiz.correct ? messages.live.potRight : messages.live.potWrong, {
            pot: formatAmount(potQuiz.answer, settings, true),
            guess: formatAmount(potQuiz.guess, settings, true),
          })}
        </div>
      )}
      {legal!.canRaise && (
        <div className="sizing">
          {!manual && <div className="presets">
            {presets.map((p) => (
              <button
                key={`${p.label}-${p.to}`}
                className={`preset ${p.to === raiseTo ? 'preset-active' : ''}`}
                onClick={() => setAmount(p.to)}
              >
                {p.label}
              </button>
            ))}
          </div>}
          <div className="slider-row">
            {!manual && <input
              className="amount-slider"
              type="range"
              min={legal!.minRaiseTo}
              max={sliderMax}
              step={STEP}
              value={raiseTo}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAmount(v > sliderMax - STEP ? sliderMax : v);
              }}
            />}
            {manual && <span className="manual-label">{messages.live.manualLabel}</span>}
            <input
              className="amount-input"
              type="number"
              inputMode="decimal"
              step={settings.unit === 'chips' ? settings.bigBlindAmount / 2 : 0.5}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) {
                  const units = Math.round(fromDisplay(v, settings));
                  setRaiseTo(Math.max(legal!.minRaiseTo, Math.min(legal!.maxRaiseTo, units)));
                }
              }}
              onBlur={() => setDraft(String(toDisplay(raiseTo, settings)))}
            />
            <span className="amount-unit">{settings.unit === 'bb' ? 'BB' : ''}</span>
          </div>
        </div>
      )}
      <div className="action-buttons">
        {!legal!.canCheck && (
          <button className="btn btn-fold" onClick={fold}>
            {a.fold}
            <kbd>{messages.keys.fold}</kbd>
          </button>
        )}
        <button className="btn btn-call" onClick={callOrCheck}>
          {callLabel}
          <kbd>{messages.keys.call}</kbd>
        </button>
        {legal!.canRaise && (
          <button className="btn btn-raise" onClick={raise}>
            {raiseLabel}
            <kbd>{messages.keys.raise}</kbd>
          </button>
        )}
      </div>
    </div>
  );
}

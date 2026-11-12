import { useMemo, useRef, type CSSProperties } from 'react';
import type { Card } from '../../engine/cards';
import { potTotal } from '../../engine/hand';
import type { ActionType, HandState } from '../../engine/types';
import { bestFive } from '../../eval/evaluator';
import { fmt, messages } from '../../i18n';
import { HERO, useGame } from '../../store/gameStore';
import type { Settings } from '../../store/settings';
import { formatAmount, handName } from '../format';
import { useElementSize } from '../hooks';
import { computeLayout, lerp, type Point } from '../layout';
import { CardView } from './CardView';

interface SeatLabel {
  text: string;
  type: ActionType;
}

/** Latest action of each player on the current street. */
function actionLabels(hand: HandState, settings: Settings): Map<number, SeatLabel> {
  const labels = new Map<number, SeatLabel>();
  for (let i = hand.events.length - 1; i >= 0; i--) {
    const e = hand.events[i]!;
    if (e.kind === 'deal') break;
    if (e.kind !== 'action' || labels.has(e.player)) continue;
    const a = messages.action;
    let text: string;
    if (e.type === 'fold') text = a.fold;
    else if (e.type === 'check') text = a.check;
    else if (e.allIn) text = `${a.allIn} ${formatAmount(e.to, settings)}`;
    else if (e.type === 'call') text = `${a.call} ${formatAmount(e.amount, settings)}`;
    else if (e.type === 'bet') text = `${a.bet} ${formatAmount(e.to, settings)}`;
    else text = `${a.raise} ${formatAmount(e.to, settings)}`;
    labels.set(e.player, { text, type: e.type });
  }
  return labels;
}

const pos = (p: Point): CSSProperties => ({ left: `${p.x}%`, top: `${p.y}%` });

export function TableView() {
  const hand = useGame((s) => s.hand);
  const phase = useGame((s) => s.phase);
  const revealCount = useGame((s) => s.revealCount);
  const settings = useGame((s) => s.settings);
  const seatInfo = useGame((s) => s.seats);

  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const seatCount = hand?.players.length ?? settings.numPlayers;
  const layout = useMemo(
    () => computeLayout(area.width, area.height, seatCount),
    [area.width, area.height, seatCount],
  );

  const over = phase === 'handOver';
  const result = over ? (hand?.result ?? null) : null;
  const revealed = hand ? hand.board.slice(0, revealCount) : [];
  const settled = hand ? revealCount >= hand.board.length : true;
  const labels = hand && settled && !over ? actionLabels(hand, settings) : new Map<number, SeatLabel>();

  // Cards that make the winning hand, to highlight at showdown.
  const winningCards = useMemo(() => {
    const set = new Set<Card>();
    if (!hand || !result || !result.showdown) return set;
    let top = -1;
    result.winnings.forEach((w, i) => {
      if (w > 0 && (top < 0 || w > result.winnings[top]!)) top = i;
    });
    if (top >= 0) for (const c of bestFive([...hand.players[top]!.hole, ...hand.board])) set.add(c);
    return set;
  }, [hand, result]);

  const stageStyle = {
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    '--u': `${layout.unit}px`,
  } as CSSProperties;

  const pot = hand ? potTotal(hand) : 0;
  const showPot = hand && (pot > 0 || over);

  return (
    <div className="table-area" ref={areaRef}>
      <div className={`stage ${layout.portrait ? 'stage-portrait' : 'stage-landscape'}`} style={stageStyle}>
        <div className="rail">
          <div className="felt" />
        </div>

        <div className="table-center" style={pos(layout.center)}>
          {showPot && (
            <div className="pot">
              <span className="pot-label">{messages.table.pot}</span>
              <span className="pot-amount">{formatAmount(over && result ? potAfterRake(hand) : pot, settings, true)}</span>
            </div>
          )}
          <div className="board">
            {[0, 1, 2, 3, 4].map((i) =>
              revealed[i] !== undefined ? (
                <CardView
                  key={`${hand!.handId}-${i}`}
                  card={revealed[i]}
                  fourColor={settings.fourColor}
                  size="md"
                  dimmed={winningCards.size > 0 && !winningCards.has(revealed[i]!)}
                  highlighted={winningCards.has(revealed[i]!)}
                />
              ) : (
                <div key={`slot-${i}`} className="card card-md card-slot" />
              ),
            )}
          </div>
          {over && hand && result && <WinnerBanner hand={hand} settings={settings} />}
        </div>

        {hand?.players.map((p, i) => {
          const seat = layout.seats[i]!;
          const isHero = i === HERO;
          const showCards = isHero || (over && result !== null && result.showdown && !p.folded);
          const winner = result !== null && result.winnings[i]! > 0;
          const active = phase === 'playing' && settled && hand.toAct === i;
          // Do not reveal the outcome through stack sizes while cards are still being dealt.
          const pendingWin = hand.isComplete && !over ? (hand.result?.winnings[i] ?? 0) : 0;
          const label = labels.get(i);
          const classes = ['seat'];
          if (isHero) classes.push('seat-hero');
          if (p.folded) classes.push('seat-folded');
          if (active) classes.push('seat-active');
          if (winner) classes.push('seat-winner');
          if (showCards && !isHero) classes.push('seat-shown');
          return (
            <div key={i} className={classes.join(' ')} style={pos(seat)}>
              <div className="seat-cards">
                {!p.folded || isHero
                  ? p.hole.map((c, k) => (
                      <CardView
                        key={`${hand.handId}-${k}`}
                        card={showCards ? c : undefined}
                        hidden={!showCards}
                        fourColor={settings.fourColor}
                        size={isHero ? 'lg' : showCards ? 'md' : 'sm'}
                        dimmed={(isHero && p.folded) || (winner && winningCards.size > 0 && !winningCards.has(c))}
                        highlighted={winner && winningCards.has(c)}
                      />
                    ))
                  : null}
              </div>
              <div className="seat-plate">
                <span className="seat-pos">{p.position}</span>
                <span className="seat-name">
                  {p.name}
                  {settings.showTypes && !isHero && seatInfo[i] && (
                    <em className={`seat-type type-${seatInfo[i]!.profile}`}>{messages.profile[seatInfo[i]!.profile]}</em>
                  )}
                </span>
                <span className="seat-stack">
                  {p.allIn && !over ? messages.action.allIn : formatAmount(p.stack - pendingWin, settings)}
                </span>
              </div>
              {label && <div className={`seat-action act-${label.type}`}>{label.text}</div>}
              {over && result && result.scores[i] != null && (
                <div className="seat-action act-show">{handName(result.scores[i]!)}</div>
              )}
            </div>
          );
        })}

        {hand &&
          !over &&
          settled &&
          hand.players.map((p, i) =>
            p.betThisStreet > 0 && !hand.isComplete ? (
              <div key={`bet-${i}`} className="bet" style={pos(lerp(layout.seats[i]!, layout.center, betPull(layout.portrait, i === HERO)))}>
                <span className="chip" />
                {formatAmount(p.betThisStreet, settings)}
              </div>
            ) : null,
          )}

        {hand && (
          <div
            className="dealer-button"
            style={pos(
              buttonSpot(layout.seats[hand.buttonIndex]!, layout.center, layout.portrait, hand.buttonIndex === HERO),
            )}
          >
            {messages.table.dealer}
          </div>
        )}
      </div>
    </div>
  );
}

/** How far towards the center a bet marker sits. */
function betPull(portrait: boolean, hero: boolean): number {
  if (hero) return portrait ? 0.4 : 0.46;
  return portrait ? 0.36 : 0.34;
}

/** The dealer button sits beside the seat, slightly towards the center. */
function buttonSpot(seat: Point, center: Point, portrait: boolean, hero: boolean): Point {
  // The hero's cards are large, so the button goes to their right instead of on top of them.
  if (hero) return { x: seat.x + (portrait ? 19 : 9.5), y: seat.y - 2 };
  const towards = lerp(seat, center, portrait ? 0.24 : 0.22);
  const dx = center.x - seat.x;
  const dy = center.y - seat.y;
  const len = Math.hypot(dx, dy) || 1;
  const side = portrait ? 7 : 5;
  return { x: towards.x + (-dy / len) * side, y: towards.y + (dx / len) * side };
}

function potAfterRake(hand: HandState | null): number {
  if (!hand || !hand.result) return 0;
  return hand.result.pots.reduce((sum, p) => sum + p.amount, 0);
}

function WinnerBanner({ hand, settings }: { hand: HandState; settings: Settings }) {
  const result = hand.result!;
  const lines: string[] = [];
  result.winnings.forEach((amount, i) => {
    if (amount <= 0) return;
    const name = hand.players[i]!.name;
    const score = result.scores[i];
    lines.push(
      score != null
        ? fmt(messages.table.winsWith, { name, hand: handName(score), amount: formatAmount(amount, settings, true) })
        : fmt(messages.table.wins, { name, amount: formatAmount(amount, settings, true) }),
    );
  });
  return (
    <div className="winner-banner">
      {lines.slice(0, 3).map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

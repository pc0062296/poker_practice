import { postflopOrder } from '../engine/positions';
import type { Chips, LegalActions, PublicView } from '../engine/types';
import type { PreflopScenario } from './scenario';

export interface SizingOptions {
  /** Standard open-raise size in units of the blind level, e.g. 3 for 3 big blinds. */
  openSize: number;
}

export const DEFAULT_SIZING: SizingOptions = { openSize: 3 };

/** A raise that commits at least this share of the stack becomes an all-in. */
const SHOVE_FRACTION = 0.45;

/** Round to the nearest small blind so sizes look like real chip amounts. */
export function roundToChip(amount: number, view: PublicView): Chips {
  const unit = Math.max(1, view.config.smallBlind);
  return Math.round(amount / unit) * unit;
}

/** Clamp a desired "raise to" amount to the legal range, shoving when nearly committed. */
export function clampRaise(desired: number, legal: LegalActions, view: PublicView): Chips {
  let to = roundToChip(desired, view);
  if (to >= legal.maxRaiseTo * SHOVE_FRACTION) to = legal.maxRaiseTo;
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
}

/** The standard preflop raise size for the actor's situation. */
export function standardPreflopRaiseTo(
  view: PublicView,
  actor: number,
  scenario: PreflopScenario,
  legal: LegalActions,
  options: SizingOptions = DEFAULT_SIZING,
): Chips {
  const sit = scenario.situation;
  const n = view.players.length;
  const position = view.players[actor]!.position;
  const deep = scenario.depth === 200;
  let desired: number;

  if (sit.raises === 0) {
    const blindSeat = position === 'SB' || position === 'BB';
    desired = (options.openSize + sit.limpers.length + (blindSeat ? 0.5 : 0)) * sit.level;
  } else {
    const inPosition =
      postflopOrder(n, view.buttonIndex, actor) > postflopOrder(n, view.buttonIndex, sit.lastRaiser);
    if (sit.raises === 1) {
      const mult = (inPosition ? 3 : 4) + (deep ? 0.5 : 0);
      desired = sit.lastRaiseTo * (mult + sit.callers.length);
    } else if (sit.raises === 2) {
      const mult = (inPosition ? 2.3 : 2.6) + (deep ? 0.15 : 0);
      desired = sit.lastRaiseTo * mult;
    } else {
      desired = sit.lastRaiseTo * 2.3;
    }
  }
  return clampRaise(desired, legal, view);
}

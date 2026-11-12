import { RANK_CHARS, rankOf, suitOf, type Card } from '../engine/cards';
import type { HandEvent, HandState } from '../engine/types';
import { describeScore } from '../eval/evaluator';
import { fmt, messages } from '../i18n';
import { UNITS_PER_BB, type Settings } from '../store/settings';

/** Suit symbols: clubs, diamonds, hearts, spades. */
export const SUIT_SYMBOLS: readonly string[] = messages.symbols.suits;

export function rankLabel(card: Card): string {
  const r = RANK_CHARS[rankOf(card)]!;
  return r === 'T' ? '10' : r;
}

export function cardText(card: Card): string {
  return RANK_CHARS[rankOf(card)]! + SUIT_SYMBOLS[suitOf(card)]!;
}

function trimNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/** Format a chip amount as big blinds or as a table currency amount. */
export function formatAmount(units: number, settings: Settings, withUnit = false): string {
  const bb = units / UNITS_PER_BB;
  if (settings.unit === 'chips') {
    const value = bb * settings.bigBlindAmount;
    return Math.round(value).toLocaleString('en-US');
  }
  const text = trimNumber(bb, Math.abs(bb) >= 100 ? 1 : 2);
  return withUnit ? `${text} BB` : text;
}

/** Signed amount for results, e.g. "+12.5 BB". */
export function formatSigned(units: number, settings: Settings): string {
  const sign = units > 0 ? '+' : units < 0 ? messages.symbols.minus : '';
  return sign + formatAmount(Math.abs(units), settings, true);
}

/** Name of a made hand from its evaluator score, e.g. a pair with its rank. */
export function handName(score: number): string {
  const { category, ranks } = describeScore(score);
  const name = messages.handName[category]!;
  const r = (i: number) => {
    const ch = RANK_CHARS[ranks[i]!]!;
    return ch === 'T' ? '10' : ch;
  };
  const d = messages.handDetail;
  switch (category) {
    case 2:
      return fmt(d.twoPair, { name, a: r(0), b: r(1) });
    case 6:
      return fmt(d.fullHouse, { name, a: r(0), b: r(1) });
    case 4:
    case 8:
      return fmt(d.straight, { name, a: r(0) });
    default:
      return fmt(d.single, { name, a: r(0) });
  }
}

/** One line of hand history text for an event. */
export function describeEvent(event: HandEvent, hand: HandState, settings: Settings): string {
  const t = messages.log;
  const name = (i: number) => hand.players[i]!.name;
  const amount = (units: number) => formatAmount(units, settings, true);
  switch (event.kind) {
    case 'post':
      return fmt(t.post, {
        name: name(event.player),
        pos: hand.players[event.player]!.position,
        blind: messages.blind[event.blind],
        amount: amount(event.amount),
      });
    case 'deal':
      return fmt(t.deal, {
        street: messages.street[event.street],
        cards: event.cards.map(cardText).join(' '),
      });
    case 'action': {
      let text: string;
      if (event.type === 'fold') text = fmt(t.fold, { name: name(event.player) });
      else if (event.type === 'check') text = fmt(t.check, { name: name(event.player) });
      else if (event.type === 'call') text = fmt(t.call, { name: name(event.player), amount: amount(event.amount) });
      else if (event.type === 'bet') text = fmt(t.bet, { name: name(event.player), amount: amount(event.to) });
      else text = fmt(t.raise, { name: name(event.player), amount: amount(event.to) });
      return event.allIn ? text + t.allInSuffix : text;
    }
    case 'uncalled':
      return fmt(t.uncalled, { name: name(event.player), amount: amount(event.amount) });
    case 'show':
      return fmt(t.show, {
        name: name(event.player),
        cards: event.cards.map(cardText).join(' '),
        hand: handName(event.score),
      });
    case 'rake':
      return fmt(t.rake, { amount: amount(event.amount) });
    case 'win':
      return fmt(t.win, { name: name(event.player), amount: amount(event.amount) });
  }
}

/**
 * Card encoding: integer 0..51.
 *   rank = card >> 2   (0 = deuce ... 12 = ace)
 *   suit = card & 3    (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades)
 */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';

export const NUM_CARDS = 52;

export function makeCard(rank: number, suit: number): Card {
  return (rank << 2) | suit;
}

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

/** Parse a card such as "As", "Td", "2c". */
export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`Bad card: ${text}`);
  const rank = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Bad card: ${text}`);
  return makeCard(rank, suit);
}

/** Parse a space separated or concatenated list, e.g. "As Kd 7h" or "AsKd7h". */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/\s+/g, '');
  if (compact.length % 2 !== 0) throw new Error(`Bad card list: ${text}`);
  const out: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) out.push(parseCard(compact.slice(i, i + 2)));
  return out;
}

export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card)]! + SUIT_CHARS[suitOf(card)]!;
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ');
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) deck.push(c);
  return deck;
}

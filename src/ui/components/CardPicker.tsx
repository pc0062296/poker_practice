import { makeCard, type Card } from '../../engine/cards';
import { CardView } from './CardView';

const RANKS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const SUITS = [3, 2, 1, 0];

interface CardPickerProps {
  selected: readonly Card[];
  /** Cards that are taken elsewhere. */
  used?: ReadonlySet<Card>;
  max: number;
  fourColor: boolean;
  onChange(cards: Card[]): void;
}

/** A 4 x 13 grid of cards to tap. Tapping a selected card removes it. */
export function CardPicker({ selected, used, max, fourColor, onChange }: CardPickerProps) {
  const toggle = (card: Card) => {
    if (selected.includes(card)) onChange(selected.filter((c) => c !== card));
    else if (selected.length < max) onChange([...selected, card]);
    else if (max === 1) onChange([card]);
  };
  return (
    <div className="card-picker">
      {SUITS.map((suit) => (
        <div key={suit} className="picker-row">
          {RANKS.map((rank) => {
            const card = makeCard(rank, suit);
            const taken = used?.has(card) && !selected.includes(card);
            return (
              <button
                key={card}
                type="button"
                className={`picker-card ${selected.includes(card) ? 'picker-on' : ''}`}
                disabled={taken}
                onClick={() => toggle(card)}
              >
                <CardView card={card} fourColor={fourColor} size="sm" dimmed={taken} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

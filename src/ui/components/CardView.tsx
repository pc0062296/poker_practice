import { suitOf, type Card } from '../../engine/cards';
import { rankLabel, SUIT_SYMBOLS } from '../format';

interface CardViewProps {
  card?: Card;
  /** Show the back of the card. */
  hidden?: boolean;
  fourColor?: boolean;
  size?: 'sm' | 'md' | 'lg';
  dimmed?: boolean;
  highlighted?: boolean;
}

/** A single playing card, face up or face down. */
export function CardView({ card, hidden, fourColor = true, size = 'md', dimmed, highlighted }: CardViewProps) {
  const classes = ['card', `card-${size}`];
  if (dimmed) classes.push('card-dimmed');
  if (highlighted) classes.push('card-highlighted');
  if (hidden || card === undefined) {
    classes.push('card-back');
    return <div className={classes.join(' ')} aria-hidden="true" />;
  }
  const suit = suitOf(card);
  classes.push(fourColor ? `suit4-${suit}` : suit === 1 || suit === 2 ? 'suit-red' : 'suit-black');
  return (
    <div className={classes.join(' ')}>
      <span className="card-rank">{rankLabel(card)}</span>
      <span className="card-suit">{SUIT_SYMBOLS[suit]}</span>
    </div>
  );
}

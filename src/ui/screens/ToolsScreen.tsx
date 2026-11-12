import { useCallback, useEffect, useState } from 'react';
import { makeQuiz, QUIZ_KINDS, type Quiz, type QuizKind } from '../../drills/quizzes';
import { cardToString, parseCards, type Card } from '../../engine/cards';
import { cryptoRng } from '../../engine/rng';
import { expandClassWeights } from '../../eval/combos';
import { calcEquity, type EquityPlayer, type EquityResult } from '../../eval/equity';
import { fmt, messages } from '../../i18n';
import { tryParseRange } from '../../ranges/rangeString';
import { useGame } from '../../store/gameStore';
import { CardPicker } from '../components/CardPicker';
import { CardView } from '../components/CardView';
import { Modal } from '../components/Modal';
import { cardText } from '../format';

const rng = cryptoRng();

type Tab = 'equity' | 'quiz';

interface PlayerInput {
  mode: 'hand' | 'range';
  hand: Card[];
  range: string;
}

function parseCardText(text: string): Card[] | null {
  const clean = text.replace(/10/g, 'T').replace(/[\s,]+/g, '');
  if (clean === '') return [];
  try {
    return parseCards(clean);
  } catch {
    return null;
  }
}

function EquityCalculator() {
  const fourColor = useGame((s) => s.settings.fourColor);
  const t = messages.equity;
  const [players, setPlayers] = useState<PlayerInput[]>([
    { mode: 'hand', hand: parseCards('AhKh'), range: '' },
    { mode: 'range', hand: [], range: 'QQ+,AKs,AKo' },
  ]);
  const [board, setBoard] = useState<Card[]>([]);
  const [result, setResult] = useState<EquityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | 'board' | null>(null);
  const [busy, setBusy] = useState(false);

  const used = new Set<Card>([...board, ...players.flatMap((p) => (p.mode === 'hand' ? p.hand : []))]);

  const update = (i: number, patch: Partial<PlayerInput>) => {
    setPlayers(players.map((p, k) => (k === i ? { ...p, ...patch } : p)));
    setResult(null);
  };

  const calculate = () => {
    setError(null);
    const inputs: EquityPlayer[] = [];
    for (const p of players) {
      if (p.mode === 'hand') {
        if (p.hand.length !== 2) {
          setError(fmt(t.errorCards, { text: p.hand.map(cardText).join(' ') || '-' }));
          return;
        }
        inputs.push({ cards: p.hand });
      } else {
        const parsed = tryParseRange(p.range);
        if (parsed.errors.length > 0) {
          setError(fmt(t.errorRange, { list: parsed.errors.join(', ') }));
          return;
        }
        inputs.push({ range: expandClassWeights(parsed.weights) });
      }
    }
    if (![0, 3, 4, 5].includes(board.length)) {
      setError(t.boardHint);
      return;
    }
    if (used.size !== board.length + players.filter((p) => p.mode === 'hand').length * 2) {
      setError(t.errorDuplicate);
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        setResult(calcEquity(inputs, board, 30000, rng));
      } catch {
        setError(t.errorEmpty);
      }
      setBusy(false);
    }, 10);
  };

  const pickerCards = picking === 'board' ? board : picking !== null ? players[picking]!.hand : [];
  const pickerUsed = new Set<Card>([...used].filter((c) => !pickerCards.includes(c)));

  return (
    <div className="equity">
      {players.map((p, i) => (
        <div key={i} className="equity-row">
          <span className="equity-name">{fmt(t.player, { n: i + 1 })}</span>
          <div className="segmented">
            {(['hand', 'range'] as const).map((m) => (
              <button key={m} type="button" className={`segment ${p.mode === m ? 'segment-active' : ''}`} onClick={() => update(i, { mode: m })}>
                {t[m]}
              </button>
            ))}
          </div>
          {p.mode === 'hand' ? (
            <div className="equity-cards">
              <input
                className="text-input"
                defaultValue={p.hand.map(cardToString).join('')}
                key={p.hand.join(',')}
                placeholder={t.handHint}
                onBlur={(e) => {
                  const cards = parseCardText(e.target.value);
                  if (cards && cards.length <= 2) update(i, { hand: cards });
                  else setError(fmt(t.errorCards, { text: e.target.value }));
                }}
              />
              <button className="btn btn-plain btn-small" onClick={() => setPicking(i)}>
                {t.pick}
              </button>
              <span className="mini-cards">
                {p.hand.map((c) => (
                  <CardView key={c} card={c} fourColor={fourColor} size="sm" />
                ))}
              </span>
            </div>
          ) : (
            <input className="text-input text-input-wide" value={p.range} placeholder={t.rangeHint} onChange={(e) => update(i, { range: e.target.value })} spellCheck={false} />
          )}
          {players.length > 2 && (
            <button className="link-button" onClick={() => setPlayers(players.filter((_, k) => k !== i))}>
              {t.remove}
            </button>
          )}
          {result && (
            <div className="equity-result">
              <div className="equity-bar">
                <div style={{ width: `${result.equity[i]! * 100}%` }} />
              </div>
              <span className="equity-value">{(result.equity[i]! * 100).toFixed(1)}%</span>
              <span className="equity-sub">
                {t.win} {(result.win[i]! * 100).toFixed(1)}% {t.tie} {(result.tie[i]! * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      ))}
      {players.length < 4 && (
        <button className="link-button" onClick={() => setPlayers([...players, { mode: 'range', hand: [], range: '22+,A2s+,KTs+,QTs+,JTs,ATo+,KJo+' }])}>
          {t.addPlayer}
        </button>
      )}
      <div className="equity-row">
        <span className="equity-name">{t.board}</span>
        <div className="equity-cards">
          <input
            className="text-input"
            defaultValue={board.map(cardToString).join('')}
            key={board.join(',')}
            placeholder={t.boardHint}
            onBlur={(e) => {
              const cards = parseCardText(e.target.value);
              if (cards && cards.length <= 5) {
                setBoard(cards);
                setResult(null);
              } else setError(fmt(t.errorCards, { text: e.target.value }));
            }}
          />
          <button className="btn btn-plain btn-small" onClick={() => setPicking('board')}>
            {t.pick}
          </button>
          <span className="mini-cards">
            {board.map((c) => (
              <CardView key={c} card={c} fourColor={fourColor} size="sm" />
            ))}
          </span>
        </div>
      </div>
      <p className="settings-note">{t.cardHelp}</p>
      {error && <p className="form-message">{error}</p>}
      <div className="button-row">
        <button className="btn btn-primary" onClick={calculate} disabled={busy}>
          {t.calculate}
        </button>
        {result && <span className="settings-note">{result.exact ? t.exact : fmt(t.sampled, { n: result.samples })}</span>}
      </div>
      {picking !== null && (
        <Modal
          title={picking === 'board' ? t.board : fmt(t.player, { n: picking + 1 })}
          onClose={() => setPicking(null)}
          footer={
            <>
              <button
                className="btn btn-plain"
                onClick={() => {
                  if (picking === 'board') setBoard([]);
                  else update(picking, { hand: [] });
                }}
              >
                {t.clear}
              </button>
              <button className="btn btn-primary" onClick={() => setPicking(null)}>
                {t.done}
              </button>
            </>
          }
        >
          <CardPicker
            selected={pickerCards}
            used={pickerUsed}
            max={picking === 'board' ? 5 : 2}
            fourColor={fourColor}
            onChange={(cards) => {
              if (picking === 'board') setBoard(cards);
              else update(picking, { hand: cards });
              setResult(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function quizText(quiz: Quiz): string {
  const t = messages.quiz;
  const params: Record<string, string | number> = { ...quiz.params };
  if (quiz.kind === 'outs') params.street = t.street[String(quiz.params.street)] ?? '';
  return fmt(t.question[quiz.kind]!, params);
}

function explainText(quiz: Quiz): string {
  const t = messages.quiz.explain;
  const d = quiz.detail;
  switch (quiz.kind) {
    case 'potOdds':
      return fmt(t.potOdds!, { bet: d.bet!, total: d.total! });
    case 'mdf':
      return fmt(t.mdf!, { pot: d.pot!, sum: d.pot! + d.bet! });
    case 'outs':
      return fmt(t.outs!, { outs: d.outs!, mult: d.toCome === 2 ? 4 : 2, rule: d.rule!, exact: d.exact! });
    case 'potCount':
      return fmt(t.potCount!, { pot: d.pot! });
    default:
      return fmt(t.preflopEquity!, { equity: d.equity! });
  }
}

function QuizPanel() {
  const fourColor = useGame((s) => s.settings.fourColor);
  const t = messages.quiz;
  const [kinds, setKinds] = useState<QuizKind[]>(QUIZ_KINDS);
  const pickQuiz = useCallback((list: QuizKind[]) => makeQuiz(list[rng.int(list.length)]!, rng), []);
  const [quiz, setQuiz] = useState<Quiz>(() => pickQuiz(QUIZ_KINDS));
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });

  const next = useCallback(() => {
    setQuiz(pickQuiz(kinds));
    setPicked(null);
  }, [kinds, pickQuiz]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picked !== null && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, next]);

  const answer = (choice: number) => {
    if (picked !== null) return;
    setPicked(choice);
    const right = choice === quiz.answer;
    setScore((s) => ({ right: s.right + (right ? 1 : 0), total: s.total + 1, streak: right ? s.streak + 1 : 0 }));
  };
  const unit = t.unit[quiz.unit];
  const stepText = (i: number) => {
    const step = quiz.steps![i]!;
    return fmt(t.steps[step.key]!, { name: step.name ?? '', amount: step.amount !== undefined ? `${step.amount} BB` : '' });
  };

  return (
    <div className="quiz">
      <div className="filter-row">
        <button
          className={`chip ${kinds.length === QUIZ_KINDS.length ? 'chip-on' : ''}`}
          onClick={() => {
            setKinds(QUIZ_KINDS);
            setQuiz(pickQuiz(QUIZ_KINDS));
            setPicked(null);
          }}
        >
          {t.all}
        </button>
        {QUIZ_KINDS.map((k) => (
          <button
            key={k}
            className={`chip ${kinds.length === 1 && kinds[0] === k ? 'chip-on' : ''}`}
            onClick={() => {
              setKinds([k]);
              setQuiz(pickQuiz([k]));
              setPicked(null);
            }}
          >
            {t.kinds[k]}
          </button>
        ))}
      </div>
      <div className="panel quiz-card">
        <p className="quiz-question">{quizText(quiz)}</p>
        {(quiz.hero || quiz.board) && (
          <div className="quiz-cards">
            {quiz.hero && (
              <div className="quiz-hand">
                <span className="quiz-label">{t.you}</span>
                {quiz.hero.map((c) => (
                  <CardView key={c} card={c} fourColor={fourColor} size="md" />
                ))}
              </div>
            )}
            {quiz.villain && (
              <div className="quiz-hand">
                <span className="quiz-label">{t.villain}</span>
                {quiz.villain.map((c) => (
                  <CardView key={c} card={c} fourColor={fourColor} size="md" />
                ))}
              </div>
            )}
            {quiz.board && (
              <div className="quiz-hand">
                {quiz.board.map((c) => (
                  <CardView key={c} card={c} fourColor={fourColor} size="md" />
                ))}
              </div>
            )}
          </div>
        )}
        {quiz.steps && (
          <ol className="quiz-steps">
            {quiz.steps.map((step, i) => (
              <li key={i} className={step.key === 'street' ? 'quiz-street' : ''}>
                {stepText(i)}
              </li>
            ))}
          </ol>
        )}
        <div className="quiz-choices">
          {quiz.choices.map((c) => (
            <button
              key={c}
              className={`btn btn-plain quiz-choice ${picked !== null && c === quiz.answer ? 'quiz-right' : ''} ${picked === c && c !== quiz.answer ? 'quiz-wrong' : ''}`}
              onClick={() => answer(c)}
              disabled={picked !== null}
            >
              {c}
              {unit}
            </button>
          ))}
        </div>
        {picked !== null && (
          <div className="quiz-feedback">
            <p className={picked === quiz.answer ? 'amount-win' : 'amount-lose'}>
              {picked === quiz.answer ? t.correct : fmt(t.wrong, { answer: `${quiz.answer}${unit}` })}
            </p>
            <p>{explainText(quiz)}</p>
            <button className="btn btn-primary" onClick={next}>
              {t.next}
              <kbd>{messages.keys.next}</kbd>
            </button>
          </div>
        )}
      </div>
      <p className="settings-note">
        {fmt(t.score, { right: score.right, total: score.total })}
        {score.streak >= 2 && `${messages.symbols.separator}${fmt(t.streak, { n: score.streak })}`}
      </p>
    </div>
  );
}

export function ToolsScreen() {
  const [tab, setTab] = useState<Tab>('quiz');
  return (
    <main className="screen">
      <div className="screen-body tools">
        <div className="tabs tabs-inline" role="tablist">
          {(['quiz', 'equity'] as Tab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className={`tab ${tab === x ? 'tab-active' : ''}`} onClick={() => setTab(x)}>
              {messages.tools.tabs[x]}
            </button>
          ))}
        </div>
        <section className="panel">{tab === 'equity' ? <EquityCalculator /> : <QuizPanel />}</section>
      </div>
    </main>
  );
}

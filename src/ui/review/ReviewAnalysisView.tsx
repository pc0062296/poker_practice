import { useEffect, useMemo, useState } from 'react';
import type { Action } from '../../engine/types';
import { gradeInBackground } from '../../grading/client';
import type { PostflopGrade } from '../../grading/postflop';
import { fmt, messages } from '../../i18n';
import { allChartOverrides } from '../../ranges/charts';
import { analyzeReview, UNUSUAL } from '../../review/analyze';
import { buildHand, isComplete, reviewPositions, toRecord, type ReviewHand } from '../../review/model';
import { useGame } from '../../store/gameStore';
import { GradeCard } from '../components/Feedback';
import { PostflopCard } from '../components/PostflopCard';
import { RangeHeat } from '../components/RangeHeat';
import { TableCanvas } from '../components/TableView';
import { cardText, formatAmount } from '../format';

interface Props {
  review: ReviewHand;
  onEdit(): void;
  onBack(): void;
}

function actionText(action: Action, toCall: number, settings: ReturnType<typeof useGame.getState>['settings']): string {
  const a = messages.action;
  switch (action.type) {
    case 'fold':
      return a.fold;
    case 'check':
      return a.check;
    case 'call':
      return `${a.call} ${formatAmount(toCall, settings, true)}`;
    case 'bet':
      return `${a.bet} ${formatAmount(action.amount ?? 0, settings, true)}`;
    default:
      return `${a.raiseTo} ${formatAmount(action.amount ?? 0, settings, true)}`;
  }
}

export function ReviewAnalysisView({ review, onEdit, onBack }: Props) {
  const settings = useGame((s) => s.settings);
  const t = messages.review;
  const analysis = useMemo(() => analyzeReview(review, settings.customProfile), [review, settings.customProfile]);
  const total = analysis.steps.length;
  const [step, setStep] = useState(0);
  const [postflop, setPostflop] = useState<PostflopGrade[] | null>(null);
  const [partial, setPartial] = useState<PostflopGrade[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [godView, setGodView] = useState(false);
  const canReveal = !!review.allHoles;

  const positions = reviewPositions(review);
  const names = positions.map((p, i) => (i === 0 ? messages.heroName : p));
  const built = useMemo(() => buildHand(review, step, names), [review, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const hand = built.hand;
  const done = isComplete(review) && step === total;

  useEffect(() => {
    let cancelled = false;
    setPostflop(null);
    setPartial([]);
    const hasPostflop = analysis.steps.some((s) => s.actor === 0 && s.street !== 'preflop');
    if (!hasPostflop) {
      setPostflop([]);
      return;
    }
    const got: PostflopGrade[] = [];
    gradeInBackground(
      {
        record: toRecord(review),
        heroIndex: 0,
        profiles: review.profiles,
        custom: settings.customProfile,
        useActualTypes: true,
        sizing: { openSize: settings.openSizeBB },
        chartOverrides: allChartOverrides(),
      },
      (g) => {
        got.push(g);
        if (!cancelled) setPartial(got.slice());
      },
    )
      .then((grades) => {
        if (!cancelled) setPostflop(grades);
      })
      .catch(() => {
        if (!cancelled) setPostflop([]);
      });
    return () => {
      cancelled = true;
    };
  }, [review, analysis, settings.customProfile, settings.openSizeBB]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(total, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const grades = postflop ?? partial;
  const solveJob = (actionIndex: number) => ({
    record: toRecord(review),
    heroIndex: 0,
    profiles: review.profiles,
    custom: settings.customProfile,
    useActualTypes: true,
    sizing: { openSize: settings.openSizeBB },
    chartOverrides: allChartOverrides(),
    actionIndex,
  });
  const nextStep = analysis.steps[step];
  const heroNext = nextStep?.actor === 0;
  const preflopHere = heroNext ? analysis.preflop.find((g) => g.actionIndex === step) : undefined;
  const postflopHere = heroNext ? grades.find((g) => g.actionIndex === step) : undefined;
  const ranges = analysis.ranges[step] ?? [];
  const liveOpponents = ranges.map((r, i) => (r ? i : -1)).filter((i) => i > 0);
  const shownSeat = selected !== null && ranges[selected] ? selected : (liveOpponents[0] ?? null);
  const lastStep = step > 0 ? analysis.steps[step - 1] : null;
  const lastToCall = step > 0 ? buildHand(review, step - 1).hand : null;

  return (
    <div className="screen-body review-analysis">
      <section className="panel review-main">
        <div className="grade-head">
          <h2 className="panel-heading">
            {review.title || t.untitled}
            <span className="grade-board">
              {positions[0]} {review.heroCards.map(cardText).join(' ')}
            </span>
          </h2>
          <span className="button-row review-top-buttons">
            <button className="link-button" onClick={onEdit}>
              {t.open}
            </button>
            <button className="link-button" onClick={onBack}>
              {t.back}
            </button>
          </span>
        </div>
        <div className="review-table">
          <TableCanvas
            hand={hand}
            heroIndex={0}
            seatCount={review.numPlayers}
            revealCount={hand.board.length}
            over={done}
            showTurn={!hand.isComplete}
            seats={positions.map((_, i) => ({ name: names[i]!, profile: review.profiles[i] ?? 'population' }))}
            settings={settings}
            known={(i) => i === 0 || !!review.shown[i] || (godView && canReveal)}
            faceUp={godView && canReveal ? () => true : undefined}
            showTypes
          />
        </div>
        {canReveal && (
          <label className="check god-view">
            <input type="checkbox" checked={godView} onChange={(e) => setGodView(e.target.checked)} />
            {t.godView}
          </label>
        )}
        <div className="stepper">
          <button className="btn btn-plain btn-small" onClick={() => setStep(0)} disabled={step === 0}>
            {t.start}
          </button>
          <button className="btn btn-plain btn-small" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            {'<'}
          </button>
          <input type="range" min={0} max={total} value={step} onChange={(e) => setStep(Number(e.target.value))} />
          <button className="btn btn-plain btn-small" onClick={() => setStep(Math.min(total, step + 1))} disabled={step === total}>
            {'>'}
          </button>
          <span className="stepper-label">{fmt(t.stepLabel, { k: step, n: total })}</span>
        </div>
        {lastStep && lastToCall && (
          <p className="step-text">
            {fmt(t.stepText, {
              pos: positions[lastStep.actor]!,
              action: actionText(lastStep.action, Math.min(lastToCall.currentBet - lastToCall.players[lastStep.actor]!.betThisStreet, lastToCall.players[lastStep.actor]!.stack), settings),
            })}
            {lastStep.actor !== 0 && lastStep.likelihood < UNUSUAL && <span className="badge badge-inaccuracy step-badge">{t.unusual}</span>}
          </p>
        )}
        {heroNext && <p className="step-hero">{t.nextHeroDecision}</p>}
        {preflopHere && <GradeCard grade={preflopHere} settings={settings} />}
        {postflopHere && <PostflopCard grade={postflopHere} settings={settings} solveJob={solveJob} />}
        {heroNext && nextStep && nextStep.street !== 'preflop' && !postflopHere && postflop === null && (
          <p className="grading-pending">
            <span className="spinner" aria-hidden="true" />
            {messages.postflop.pending}
          </p>
        )}
      </section>

      <section className="panel">
        <h3 className="panel-title">{t.rangesTitle}</h3>
        {liveOpponents.length === 0 ? (
          <p className="panel-empty">{messages.history.empty}</p>
        ) : (
          <>
            <div className="filter-row">
              {liveOpponents.map((i) => (
                <button key={i} className={`chip ${shownSeat === i ? 'chip-on' : ''}`} onClick={() => setSelected(i)}>
                  {positions[i]} <em className={`seat-type type-${review.profiles[i]}`}>{messages.profile[review.profiles[i] ?? 'population']}</em>
                </button>
              ))}
            </div>
            {shownSeat !== null && ranges[shownSeat] && (
              <>
                <RangeHeat classes={ranges[shownSeat]!.classes} />
                <p className="settings-note">{fmt(t.width, { x: Math.round(ranges[shownSeat]!.width * 1000) / 10 })}</p>
                {ranges[shownSeat]!.mix && (
                  <div className="mix-text">
                    {(['strong', 'medium', 'draw', 'weak'] as const).map((k) => (
                      <span key={k}>
                        <i className={`swatch mix-${k}`} />
                        {messages.postflop.mix[k]} {Math.round(ranges[shownSeat]!.mix![k] * 100)}%
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
        <p className="grade-note">{t.modelNote}</p>
      </section>

      <section className="panel review-all">
        <h3 className="panel-title">{t.gradesTitle}</h3>
        {analysis.preflop.length === 0 && grades.length === 0 && postflop !== null && <p className="panel-empty">{t.noGrades}</p>}
        {analysis.preflop.map((g) => (
          <div key={`p${g.actionIndex}`} className="grade-jump" onClick={() => setStep(g.actionIndex)}>
            <GradeCard grade={g} settings={settings} />
          </div>
        ))}
        {grades.map((g) => (
          <div key={`f${g.actionIndex}`} className="grade-jump" onClick={() => setStep(g.actionIndex)}>
            <PostflopCard grade={g} settings={settings} solveJob={solveJob} />
          </div>
        ))}
        {postflop === null && (
          <p className="grading-pending">
            <span className="spinner" aria-hidden="true" />
            {messages.postflop.pending}
          </p>
        )}
      </section>
    </div>
  );
}

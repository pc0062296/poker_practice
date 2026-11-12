import { useCallback, useEffect, useRef, useState } from 'react';
import { fmt, messages } from '../../i18n';
import { isComplete, newReview, reviewPositions, type ReviewHand } from '../../review/model';
import { deleteReview, listReviews, saveReview } from '../../storage/reviewStore';
import { useGame } from '../../store/gameStore';
import { useReviewUi } from '../../store/reviewUi';
import { CardView } from '../components/CardView';
import { ReviewAnalysisView } from '../review/ReviewAnalysisView';
import { ReviewEditor } from '../review/ReviewEditor';

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReviewList({ onOpen }: { onOpen(review: ReviewHand, mode: 'edit' | 'analyze'): void }) {
  const fourColor = useGame((s) => s.settings.fourColor);
  const t = messages.review;
  const [items, setItems] = useState<ReviewHand[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => {
    void listReviews().then(setItems);
  }, []);
  useEffect(refresh, [refresh]);

  const onImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { reviews?: ReviewHand[] } | ReviewHand[];
      const list = Array.isArray(data) ? data : (data.reviews ?? []);
      let n = 0;
      for (const r of list) {
        if (!r || !Array.isArray(r.actions) || !Array.isArray(r.stacks)) continue;
        const { id: _drop, ...rest } = r;
        void _drop;
        if ((await saveReview(rest as ReviewHand)) !== null) n++;
      }
      setMessage(fmt(t.imported, { n }));
      refresh();
    } catch {
      setMessage(fmt(messages.rangesScreen.importErrors, { list: 'JSON' }));
    }
  };

  return (
    <div className="screen-body review-list">
      <section className="panel">
        <h2 className="panel-heading">{t.title}</h2>
        <p className="settings-note">{t.intro}</p>
        <div className="button-row">
          <button className="btn btn-primary" onClick={() => onOpen(newReview(), 'edit')}>
            {t.newHand}
          </button>
          <span className="spacer" />
          <button className="btn btn-plain" disabled={items.length === 0} onClick={() => download('poker-practice-reviews.json', JSON.stringify({ reviews: items }, null, 2))}>
            {t.exportAll}
          </button>
          <button className="btn btn-plain" onClick={() => fileRef.current?.click()}>
            {t.importFile}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImport(file);
              e.target.value = '';
            }}
          />
        </div>
        {message && <p className="form-message">{message}</p>}
      </section>
      <section className="panel">
        {items.length === 0 ? (
          <p className="panel-empty">{t.empty}</p>
        ) : (
          <ul className="review-items">
            {items.map((r) => (
              <li key={r.id} className="review-item">
                <span className="review-cards mini-cards">
                  {r.heroCards.map((c) => (
                    <CardView key={c} card={c} fourColor={fourColor} size="sm" />
                  ))}
                </span>
                <span className="review-item-main">
                  <strong>{r.title || t.untitled}</strong>
                  <span className="settings-note">
                    {reviewPositions(r)[0]}
                    {messages.symbols.separator}
                    {fmt(t.actions, { n: r.actions.length })}
                    {messages.symbols.separator}
                    {new Date(r.updatedAt).toLocaleDateString()}
                    {!isComplete(r) && ` ${messages.symbols.separator}${t.incomplete}`}
                  </span>
                </span>
                <span className="button-row review-item-buttons">
                  <button className="btn btn-plain btn-small" onClick={() => onOpen(r, 'edit')}>
                    {t.open}
                  </button>
                  <button className="btn btn-primary btn-small" disabled={r.actions.length === 0} onClick={() => onOpen(r, 'analyze')}>
                    {t.analyze}
                  </button>
                  <button
                    className="btn btn-plain btn-small"
                    onClick={() => {
                      if (r.id !== undefined && window.confirm(t.confirmRemove)) void deleteReview(r.id).then(refresh);
                    }}
                  >
                    {t.remove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ReviewScreen() {
  const { mode, current, open, update, close } = useReviewUi();
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const save = async (review: ReviewHand): Promise<ReviewHand> => {
    const id = await saveReview(review);
    const next = id !== null ? { ...review, id } : review;
    update(next);
    setSavedNote(id !== null ? messages.review.saved : null);
    return next;
  };

  return (
    <main className="screen">
      {mode === 'list' || !current ? (
        <ReviewList onOpen={(r, m) => open(r, m)} />
      ) : mode === 'edit' ? (
        <ReviewEditor
          review={current}
          savedNote={savedNote}
          onChange={(r) => {
            setSavedNote(null);
            update({ ...r, updatedAt: Date.now() });
          }}
          onSave={() => void save(current)}
          onAnalyze={() => void save(current).then((r) => open(r, 'analyze'))}
          onBack={close}
        />
      ) : (
        <ReviewAnalysisView review={current} onEdit={() => open(current, 'edit')} onBack={close} />
      )}
    </main>
  );
}

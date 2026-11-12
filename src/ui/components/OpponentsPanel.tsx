import { emptyCounts, summarize, type StatSummary } from '../../game/stats';
import { messages } from '../../i18n';
import { HERO, useGame } from '../../store/gameStore';

const pct = (x: number | null) => (x === null ? messages.stats.none : `${Math.round(x * 100)}`);

/** Statistics observed for each seat, like the notes a live player keeps in their head. */
export function OpponentsPanel() {
  const seats = useGame((s) => s.seats);
  const counts = useGame((s) => s.seatCounts);
  const showTypes = useGame((s) => s.settings.showTypes);
  const t = messages.opponents;
  if (seats.length === 0) return <p className="panel-empty">{messages.history.empty}</p>;
  const rows: { name: string; profile: string; stats: StatSummary; hero: boolean }[] = seats.map((seat, i) => ({
    name: i === HERO ? t.you : seat.name,
    profile: seat.profile,
    stats: summarize(counts[i] ?? emptyCounts()),
    hero: i === HERO,
  }));
  return (
    <div className="opponents">
      <h3 className="panel-title">{t.title}</h3>
      <table className="stat-table">
        <thead>
          <tr>
            <th />
            <th>{t.hands}</th>
            <th>{t.vpip}</th>
            <th>{t.pfr}</th>
            <th>{t.limp}</th>
            <th>{t.threeBet}</th>
            <th>{t.wtsd}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.hero ? 'stat-row-hero' : ''}>
              <td className="stat-name">
                <span>{r.name}</span>
                {!r.hero && (
                  <em className={`seat-type type-${showTypes ? r.profile : 'hidden'}`}>
                    {showTypes ? messages.profile[r.profile] : t.hidden}
                  </em>
                )}
              </td>
              <td>{r.stats.hands}</td>
              <td>{pct(r.stats.vpip)}</td>
              <td>{pct(r.stats.pfr)}</td>
              <td>{pct(r.stats.limp)}</td>
              <td>{pct(r.stats.threeBet)}</td>
              <td>{pct(r.stats.wtsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="grade-note">{t.note}</p>
      {showTypes && (
        <dl className="profile-list">
          {Array.from(new Set(seats.slice(1).map((s) => s.profile))).map((id) => (
            <div key={id}>
              <dt>
                <em className={`seat-type type-${id}`}>{messages.profile[id]}</em>
              </dt>
              <dd>{messages.profileDescription[id]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

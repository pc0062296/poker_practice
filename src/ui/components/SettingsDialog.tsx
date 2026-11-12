import { useState, type ReactNode } from 'react';
import { fmt, messages } from '../../i18n';
import { useGame } from '../../store/gameStore';
import { needsRestart, sanitizeSettings, type Settings } from '../../store/settings';
import { Modal } from './Modal';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  );
}

interface ChoiceProps<T extends string | number | boolean> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

function Choice<T extends string | number | boolean>({ value, options, onChange }: ChoiceProps<T>) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`segment ${o.value === value ? 'segment-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <span className="number-field">
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {suffix && <span className="number-suffix">{suffix}</span>}
    </span>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const current = useGame((s) => s.settings);
  const phase = useGame((s) => s.phase);
  const applySettings = useGame((s) => s.applySettings);
  const [draft, setDraft] = useState<Settings>(current);
  const t = messages.settings;
  const patch = (p: Partial<Settings>) => setDraft({ ...draft, ...p });
  const clean = sanitizeSettings(draft);
  const restart = phase !== 'welcome' && needsRestart(current, clean);
  const buyIns = [100, 200, 250];

  const apply = () => {
    applySettings(clean);
    onClose();
  };

  return (
    <Modal
      title={t.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-plain" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="btn btn-primary" onClick={apply}>
            {restart ? t.applyRestart : t.apply}
          </button>
        </>
      }
    >
      <h3 className="settings-section">{t.tableSection}</h3>
      <Row label={t.numPlayers}>
        <Choice
          value={draft.numPlayers}
          options={[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: n, label: String(n) }))}
          onChange={(numPlayers) => patch({ numPlayers })}
        />
      </Row>
      <Row label={t.heroBuyIn}>
        <Choice
          value={buyIns.includes(draft.heroBuyInBB) ? draft.heroBuyInBB : -1}
          options={[...buyIns.map((n) => ({ value: n, label: `${n}` })), { value: -1, label: t.custom }]}
          onChange={(v) => patch({ heroBuyInBB: v === -1 ? 150 : v })}
        />
        {!buyIns.includes(draft.heroBuyInBB) && (
          <NumberField value={draft.heroBuyInBB} min={20} max={1000} step={10} suffix={t.bb} onChange={(heroBuyInBB) => patch({ heroBuyInBB })} />
        )}
      </Row>
      <Row label={t.botBuyIn}>
        <NumberField value={draft.botBuyInMinBB} min={20} max={1000} step={10} onChange={(botBuyInMinBB) => patch({ botBuyInMinBB })} />
        <span className="field-dash">{messages.symbols.rangeDash}</span>
        <NumberField value={draft.botBuyInMaxBB} min={20} max={1000} step={10} suffix={t.bb} onChange={(botBuyInMaxBB) => patch({ botBuyInMaxBB })} />
      </Row>
      <Row label={t.topUp}>
        <Choice
          value={draft.topUp}
          options={[
            { value: 'always', label: t.topUpAlways },
            { value: 'bust', label: t.topUpBust },
          ]}
          onChange={(topUp) => patch({ topUp })}
        />
      </Row>
      <Row label={t.straddle}>
        <Choice
          value={draft.straddle}
          options={[
            { value: 'off', label: t.straddleOff },
            { value: 'sometimes', label: t.straddleSometimes },
            { value: 'always', label: t.straddleAlways },
          ]}
          onChange={(straddle) => patch({ straddle })}
        />
      </Row>
      <Row label={t.rake}>
        <NumberField value={draft.rakePercent} min={0} max={20} step={0.5} suffix="%" onChange={(rakePercent) => patch({ rakePercent })} />
        <span className="field-hint">{t.rakeCap}</span>
        <NumberField value={draft.rakeCapBB} min={0} max={100} step={0.5} onChange={(rakeCapBB) => patch({ rakeCapBB })} />
        <label className="check">
          <input type="checkbox" checked={draft.noFlopNoDrop} onChange={(e) => patch({ noFlopNoDrop: e.target.checked })} />
          {t.noFlopNoDrop}
        </label>
      </Row>
      <Row label={t.openSize}>
        <Choice
          value={draft.openSizeBB}
          options={[2.5, 3, 4, 5].map((n) => ({ value: n, label: `${n} ${t.bb}` }))}
          onChange={(openSizeBB) => patch({ openSizeBB })}
        />
      </Row>

      <h3 className="settings-section">{t.displaySection}</h3>
      <Row label={t.botSpeed}>
        <Choice
          value={draft.botSpeed}
          options={[
            { value: 'fast', label: t.speedFast },
            { value: 'normal', label: t.speedNormal },
            { value: 'slow', label: t.speedSlow },
          ]}
          onChange={(botSpeed) => patch({ botSpeed })}
        />
      </Row>
      <Row label={t.unit}>
        <Choice
          value={draft.unit}
          options={[
            { value: 'bb', label: t.unitBB },
            { value: 'chips', label: t.unitChips },
          ]}
          onChange={(unit) => patch({ unit })}
        />
        {draft.unit === 'chips' && (
          <>
            <span className="field-hint">{t.bigBlindAmount}</span>
            <NumberField value={draft.bigBlindAmount} min={1} max={1000000} onChange={(bigBlindAmount) => patch({ bigBlindAmount })} />
          </>
        )}
      </Row>
      <Row label={t.autoNext}>
        <Choice
          value={draft.autoNextSeconds}
          options={[
            { value: 0, label: t.autoNextOff },
            { value: 2, label: fmt(t.seconds, { n: 2 }) },
            { value: 4, label: fmt(t.seconds, { n: 4 }) },
          ]}
          onChange={(autoNextSeconds) => patch({ autoNextSeconds })}
        />
      </Row>
      <Row label="">
        <label className="check">
          <input type="checkbox" checked={draft.skipAfterFold} onChange={(e) => patch({ skipAfterFold: e.target.checked })} />
          {t.skipAfterFold}
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.fourColor} onChange={(e) => patch({ fourColor: e.target.checked })} />
          {t.fourColor}
        </label>
      </Row>
    </Modal>
  );
}

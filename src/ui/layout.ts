export interface Point {
  x: number;
  y: number;
}

export interface StageLayout {
  portrait: boolean;
  /** Stage size in pixels. */
  width: number;
  height: number;
  /** Base length unit in pixels; all table sizes are multiples of it. */
  unit: number;
  center: Point;
  /** Seat centers in percent of the stage, index 0 = hero at the bottom. */
  seats: Point[];
}

const MAX_ASPECT = 1.95;
const MIN_ASPECT = 0.6;
const PORTRAIT_BELOW = 0.9;

/**
 * Seats spaced evenly along an ellipse by arc length, starting at the bottom and going
 * clockwise (the direction play moves around the table).
 */
export function seatPositions(count: number, aspect: number, rx: number, ry: number, center: Point): Point[] {
  const steps = 1440;
  const xs: number[] = [];
  const ys: number[] = [];
  const lengths: number[] = [0];
  for (let s = 0; s <= steps; s++) {
    const t = Math.PI / 2 + (2 * Math.PI * s) / steps;
    xs.push(rx * Math.cos(t));
    ys.push(ry * Math.sin(t));
    if (s > 0) {
      const dx = (xs[s]! - xs[s - 1]!) * aspect;
      const dy = ys[s]! - ys[s - 1]!;
      lengths.push(lengths[s - 1]! + Math.hypot(dx, dy));
    }
  }
  const total = lengths[steps]!;
  const out: Point[] = [];
  let s = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / count;
    while (s < steps && lengths[s + 1]! < target) s++;
    out.push({ x: center.x + xs[s]!, y: center.y + ys[s]! });
  }
  return out;
}

/** Fit the table into the available area and place the seats. */
export function computeLayout(areaWidth: number, areaHeight: number, seatCount: number): StageLayout {
  let width = Math.max(1, areaWidth);
  let height = Math.max(1, areaHeight);
  const aspect = width / height;
  if (aspect > MAX_ASPECT) width = height * MAX_ASPECT;
  else if (aspect < MIN_ASPECT) height = width / MIN_ASPECT;
  const portrait = width / height < PORTRAIT_BELOW;
  const unit = portrait ? Math.min(width / 50, height / 80) : Math.min(width / 100, height / 58);
  const center: Point = portrait ? { x: 50, y: 47 } : { x: 50, y: 46 };
  const rx = portrait ? 36.5 : 42.5;
  const ry = portrait ? 41 : 38.5;
  return {
    portrait,
    width,
    height,
    unit,
    center,
    seats: seatPositions(seatCount, width / height, rx, ry, center),
  };
}

/** Point part of the way from `from` towards `to`. */
export function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

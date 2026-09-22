import { memo, useEffect, useRef } from 'react';
import { toArabicDigits, type PrayerEvent } from '@/lib/timeEngine';

const SIZE = 460;
const C = SIZE / 2;
/** Extra viewBox padding so the outer prayer labels are never clipped. */
const PAD = 44;

/** Point on the dial: theta in degrees from the top, positive = clockwise. */
function point(r: number, thetaDeg: number): [number, number] {
  const t = (thetaDeg * Math.PI) / 180;
  return [C + r * Math.sin(t), C - r * Math.cos(t)];
}

/** Annular sector path from theta1 to theta2 (degrees from top, clockwise positive). */
function arcPath(rOuter: number, rInner: number, theta1: number, theta2: number): string {
  const span = theta2 - theta1;
  const largeArc = Math.abs(span) > 180 ? 1 : 0;
  // Decreasing theta = anti-clockwise travel = SVG sweep flag 0 on the outer arc.
  const sweepOuter = span >= 0 ? 1 : 0;
  const [x1, y1] = point(rOuter, theta1);
  const [x2, y2] = point(rOuter, theta2);
  const [x3, y3] = point(rInner, theta2);
  const [x4, y4] = point(rInner, theta1);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} ${sweepOuter} ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} ${1 - sweepOuter} ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** Soft, low-saturation hue per prayer segment (in Islamic-day order). */
const ARC_COLORS = [
  '#D9A7A0', // Maghrib → Isha   · dusty rose
  '#A8B4C4', // Isha → Fajr      · slate
  '#E3D3AC', // Fajr → Sunrise   · sand
  '#B5C4A8', // Sunrise → Dhuhr  · sage
  '#D9AE8E', // Dhuhr → Asr      · terracotta
  '#C2C29B', // Asr → Maghrib    · olive
];

const R_ARC_OUT = 218;
const R_ARC_IN = 196;
const R_NUMERAL = 172;
const R_TICK_OUT = 190;
const R_TICK_IN_MIN = 184;
const R_TICK_IN_HOUR = 178;
const R_LABEL = 236;
const R_MARKER = 207;

/**
 * The moving hands. Updates the SVG transform attributes DIRECTLY via refs —
 * zero React re-renders. Normal mode: requestAnimationFrame (buttery sweep).
 * Low-power mode: 1 Hz interval updates and no second hand (battery saver).
 */
function ClockHands({ startMs, lowPower }: { startMs: number; lowPower: boolean }) {
  const hourRef = useRef<SVGGElement>(null);
  const minuteRef = useRef<SVGGElement>(null);
  const secondRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const update = () => {
      const elapsed = Math.max(0, Date.now() - startMs);
      // Anti-clockwise: all angles negative from the top.
      const hAngle = -(elapsed / 3_600_000) * 15;
      const mAngle = -((elapsed / 60_000) % 60) * 6;
      const sAngle = -((elapsed / 1000) % 60) * 6;
      hourRef.current?.setAttribute('transform', `rotate(${hAngle} ${C} ${C})`);
      minuteRef.current?.setAttribute('transform', `rotate(${mAngle} ${C} ${C})`);
      secondRef.current?.setAttribute('transform', `rotate(${sAngle} ${C} ${C})`);
    };
    if (lowPower) {
      update();
      const id = window.setInterval(update, 1000);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [startMs, lowPower]);

  return (
    <>
      {/* hour hand — ink, anti-clockwise */}
      <g ref={hourRef}>
        <path d={`M ${C - 3.4} ${C + 14} L ${C} ${C - 108} L ${C + 3.4} ${C + 14} Z`} fill="#3A352C" />
      </g>
      {/* minute hand — mosque green, anti-clockwise */}
      <g ref={minuteRef}>
        <path d={`M ${C - 2.4} ${C + 16} L ${C} ${C - 156} L ${C + 2.4} ${C + 16} Z`} fill="#1F5C4D" />
      </g>
      {/* second hand — gold with counterweight, anti-clockwise (hidden in low-power mode) */}
      {!lowPower && (
        <g ref={secondRef}>
          <line x1={C} y1={C + 26} x2={C} y2={C - 168} stroke="#B99A45" strokeWidth={1.6} strokeLinecap="round" />
          <circle cx={C} cy={C + 30} r={4.4} fill="#B99A45" />
        </g>
      )}
    </>
  );
}

export interface AnalogDialProps {
  /** Ordered prayer events of the current Islamic day (starts with Maghrib). */
  events: PrayerEvent[];
  /** Absolute start of the current Islamic day (most recent Maghrib), ms. */
  startMs: number;
  /** Low-power mode: 1 Hz hand updates, no second hand. */
  lowPower?: boolean;
}

/**
 * 24-hour anti-clockwise dial. One full revolution of the hour hand per Islamic
 * day. Hour N sits at angle -N*15° from the top; all hands rotate with negative
 * (anti-clockwise) angles. The static face renders once from props; only the
 * hands animate (via ClockHands refs).
 */
function AnalogDialInner({ events, startMs, lowPower = false }: AnalogDialProps) {
  // Prayer arcs between consecutive events (anti-clockwise => decreasing angle).
  const arcs = events.slice(0, -1).map((e, i) => {
    const next = events[i + 1];
    const a1 = -e.hoursSinceStart * 15;
    const a2 = -next.hoursSinceStart * 15;
    const mid = (a1 + a2) / 2;
    const [lx, ly] = point(R_LABEL, mid);
    return { d: arcPath(R_ARC_OUT, R_ARC_IN, a1, a2), color: ARC_COLORS[i % ARC_COLORS.length], label: e.meta.ar, lx, ly };
  });

  // 24-hour dial: hour ticks every 15° aligned with numerals 0–23, plus
  // half-hour ticks at +7.5° (a 60-tick/12-hour grid would misalign odd hours).
  const ticks = Array.from({ length: 48 }, (_, i) => {
    const theta = -i * 7.5;
    const isHour = i % 2 === 0;
    const [x1, y1] = point(R_TICK_OUT, theta);
    const [x2, y2] = point(isHour ? R_TICK_IN_HOUR : R_TICK_IN_MIN, theta);
    return { x1, y1, x2, y2, isHour };
  });

  const numerals = Array.from({ length: 24 }, (_, n) => {
    const theta = -n * 15; // hour N sits N*15° anti-clockwise from the top
    const [x, y] = point(R_NUMERAL, theta);
    return { n, x, y };
  });

  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
      className="h-auto w-full max-w-[540px]"
      role="img"
      aria-label="24-hour anti-clockwise Islamic prayer dial"
    >
      {/* face */}
      <circle cx={C} cy={C} r={R_ARC_OUT + 4} fill="#FFFFFF" stroke="#E8E0D2" strokeWidth={1} />

      {/* prayer arcs */}
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} fillOpacity={0.55} stroke="#FFFFFF" strokeWidth={1.5} />
      ))}
      {arcs.map((a, i) => (
        <text
          key={`l${i}`}
          x={a.lx}
          y={a.ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={15}
          fill="#6B6252"
          className="font-arabic"
        >
          {a.label}
        </text>
      ))}

      {/* prayer boundary markers (gold dots), skip the closing duplicate of Maghrib */}
      {events.slice(0, -1).map((e, i) => {
        const [x, y] = point(R_MARKER, -e.hoursSinceStart * 15);
        return <circle key={i} cx={x} cy={y} r={3.2} fill="#B99A45" stroke="#FFFFFF" strokeWidth={1.2} />;
      })}

      {/* minute / hour ticks */}
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={t.isHour ? '#8A8172' : '#DCD3C2'}
          strokeWidth={t.isHour ? 1.6 : 1}
          strokeLinecap="round"
        />
      ))}

      {/* Eastern Arabic hour numerals, anti-clockwise */}
      {numerals.map(({ n, x, y }) => (
        <text
          key={n}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={n % 2 === 0 ? 17 : 13}
          fill={n === 0 ? '#1F5C4D' : '#3A352C'}
          fontWeight={n === 0 ? 700 : 400}
          className="font-arabic"
        >
          {toArabicDigits(n)}
        </text>
      ))}

      {/* center caption */}
      <text x={C} y={C + 66} textAnchor="middle" fontSize={15} fill="#8A8172" className="font-arabic">
        المدينة المنورة
      </text>

      {/* animated hands — direct DOM updates, no React re-renders */}
      <ClockHands startMs={startMs} lowPower={lowPower} />

      {/* center pin */}
      <circle cx={C} cy={C} r={7} fill="#B99A45" stroke="#FAF7F2" strokeWidth={2.4} />
      <circle cx={C} cy={C} r={2.4} fill="#FAF7F2" />
    </svg>
  );
}

const AnalogDial = memo(AnalogDialInner);
export default AnalogDial;

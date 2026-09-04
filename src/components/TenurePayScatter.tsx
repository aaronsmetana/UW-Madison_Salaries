import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Customized,
} from 'recharts';
import { AXIS_TICK, GRID, fmtK } from '../lib/chartStyle';
import { Box, Text } from '@mantine/core';
import { usd } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { leastSquares } from '../lib/stats';
import { TipSurface } from './chart/ChartTooltip';
import { CrosshairLayer } from './chart/CrosshairLayer';
import { ChartData } from './ChartData';
import {
  MARK_SELF, MARK_PEER, MARK_PEER_SAME_SCHOOL, DOT_R, GUIDE_STRONG, MarkerLegend, type PeerPoint,
} from './markers';

/** A peer plus the tenure this chart needs. Everything about *marking* them lives in PeerPoint, so the
 *  peer strip on the same page draws the same person the same way. */
export interface ScatterPoint extends PeerPoint {
  tenure: number;
}

interface DotProps {
  cx?: number; cy?: number; r?: number; fill?: string; stroke?: string;
  payload?: ScatterPoint; onHover?: (p: ScatterPoint) => void; onLeave?: () => void;
}

/** A circle marker; Recharts injects cx/cy/payload when passed as a Scatter `shape`. A wide transparent
 *  hit circle behind the visible dot gives a "proximity" hover target so you don't have to land on the
 *  dot exactly; the visible circle grows a touch on hover (see `.scatter-dot` in app.css) and reports
 *  itself to the parent's crosshair via `onHover`/`onLeave`. */
function PeerDot({ cx, cy, r = DOT_R.peer, fill, stroke, payload, onHover, onLeave }: DotProps) {
  if (cx == null || cy == null) return <g />;
  return (
    <g onMouseEnter={() => payload && onHover?.(payload)} onMouseLeave={onLeave}>
      <circle cx={cx} cy={cy} r={15} fill="transparent" />
      <circle className="chart-dot" cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.9} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />
    </g>
  );
}

/** The "this person" marker: a wide transparent hit area, an expanding/fading pulse ring (static when
 *  the user prefers reduced motion), and the accent dot. */
function SelfDot({ cx, cy, payload, onHover, onLeave }: DotProps) {
  if (cx == null || cy == null) return <g />;
  const reduce = prefersReducedMotion();
  return (
    <g onMouseEnter={() => payload && onHover?.(payload)} onMouseLeave={onLeave}>
      <circle cx={cx} cy={cy} r={16} fill="transparent" />
      <circle cx={cx} cy={cy} r={9} fill="none" stroke={MARK_SELF} strokeWidth={2} opacity={reduce ? 0.45 : 0.9}>
        {!reduce && (
          <>
            <animate attributeName="r" values="9;18;9" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />
          </>
        )}
      </circle>
      <circle cx={cx} cy={cy} r={DOT_R.self} fill={MARK_SELF} stroke="var(--mantine-color-body)" strokeWidth={1.5} />
    </g>
  );
}

function ScatterTip({ active, payload }: { active?: boolean; payload?: { payload: ScatterPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipSurface>
      <Text size="xs" fw={600}>{d.name}{d.isSelf ? ' (this person)' : ''}</Text>
      <Text size="xs" c="dimmed">{d.tenure.toFixed(1)} yrs · {usd(d.pay)}</Text>
    </TipSurface>
  );
}

/**
 * Pay-vs-tenure scatter for everyone with the same title (the caller filters to the active cohort).
 * The subject pops in accent; same-school peers are green, others gray. A dashed least-squares line shows
 * the pay tenure alone predicts, and a callout reads whether the subject sits above or below that curve.
 * Hovering a point shows a crosshair that glides between points as the cursor moves; it's hidden
 * whenever the cursor isn't over the chart, rather than resting on "this person" by default.
 */
export function TenurePayScatter({
  points,
  self,
  titleLabel,
}: {
  points: ScatterPoint[];
  self: { tenure: number; pay: number } | null;
  titleLabel: string;
}) {
  const nav = useNavigate();
  const goToPeer = (pt: { personKey?: string; payload?: { personKey?: string } }) => {
    const k = pt?.personKey ?? pt?.payload?.personKey;
    if (k) nav(`/person/${encodeURIComponent(k)}`);
  };
  const reduceMotion = prefersReducedMotion();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const reg = leastSquares(points.map((p) => ({ x: p.tenure, y: p.pay })));
  const tMax = Math.max(10, ...points.map((p) => p.tenure), self?.tenure ?? 0);
  const xMax = Math.ceil(tMax / 10) * 10;
  const xTicks: number[] = [];
  for (let t = 0; t <= xMax; t += 10) xTicks.push(t);

  const others = points.filter((p) => !p.isSelf && !p.sameSchool);
  const schoolPts = points.filter((p) => !p.isSelf && p.sameSchool);
  const selfPts = points.filter((p) => p.isSelf);

  const expected = reg && self ? reg.intercept + reg.slope * self.tenure : null;
  const gap = expected != null && self ? self.pay - expected : null;
  const above = gap != null && gap >= 0;

  // The crosshair only appears while the cursor is actually over a point — no resting state on "this
  // person" when the chart isn't being interacted with. A hovered peer gets a slightly larger ring so
  // it reads as distinct from hovering the self dot.
  const active = hover;
  const emphasize = !!hover && !hover.isSelf;
  const onHover = (p: ScatterPoint) => setHover(p);
  const onLeave = () => setHover(null);

  return (
    <div>
      {expected != null && gap != null && self && (
        <Box
          mb="md"
          className={above ? undefined : 'tenure-callout'}
          style={{
            borderLeft: `3px solid ${above ? 'var(--mantine-color-pos-6)' : 'var(--mantine-color-orange-5)'}`,
            background: above ? 'var(--mantine-color-pos-light)' : 'var(--mantine-color-orange-light)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <Text size="sm">
            <b>{above ? 'Above' : 'Below'} the tenure curve.</b> At {self.tenure.toFixed(1)} yrs, {titleLabel} typically
            pays {usd(expected)}. This person earns <b>{usd(Math.abs(gap))}</b> {above ? 'more' : 'less'} than tenure alone predicts.
          </Text>
        </Box>
      )}

      {/* role="img" on the wrapper + aria-hidden on the chart itself: recharts tags every individual
          scatter point with its own unlabeled role="img" (hundreds of them for a large title), which
          reads as noise to a screen reader — one accessible summary for the whole plot instead. */}
      <div role="img" aria-label={`Scatter plot of pay versus tenure for ${titleLabel}, tenure in years on the x-axis and pay in dollars on the y-axis.`}>
      <div aria-hidden="true">
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ left: 12, right: 16, top: 10, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            type="number"
            dataKey="tenure"
            name="Tenure"
            domain={[0, xMax]}
            ticks={xTicks}
            tick={AXIS_TICK}
            tickFormatter={(v) => `${v}y`}
          />
          <YAxis
            type="number"
            dataKey="pay"
            name="Pay"
            width={56}
            tick={AXIS_TICK}
            tickFormatter={fmtK}
            domain={['auto', 'auto']}
            padding={{ top: 10, bottom: 10 }}
          />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ScatterTip />} />
          {reg && (
            <ReferenceLine
              stroke={GUIDE_STRONG.stroke}
              strokeDasharray={GUIDE_STRONG.dasharray}
              strokeWidth={GUIDE_STRONG.width}
              ifOverflow="extendDomain"
              segment={[{ x: 0, y: reg.intercept }, { x: xMax, y: reg.intercept + reg.slope * xMax }]}
            />
          )}
          <Scatter data={others} shape={<PeerDot fill={MARK_PEER} onHover={onHover} onLeave={onLeave} />} isAnimationActive={false} onClick={goToPeer} cursor="pointer" />
          <Scatter data={schoolPts} shape={<PeerDot fill={MARK_PEER_SAME_SCHOOL} onHover={onHover} onLeave={onLeave} />} isAnimationActive={false} onClick={goToPeer} cursor="pointer" />
          <Scatter data={selfPts} shape={<SelfDot onHover={onHover} onLeave={onLeave} />} isAnimationActive={false} />
          {active && (
            <Customized
              component={CrosshairLayer}
              pointX={active.tenure}
              pointY={active.pay}
              xPillLabel={`${active.tenure.toFixed(1)}y`}
              yPillLabel={usd(active.pay)}
              emphasize={emphasize}
              instant={reduceMotion}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      </div>
      </div>

      <MarkerLegend
        items={[
          { color: MARK_SELF, round: true, label: 'This person' },
          ...(schoolPts.length ? [{ color: MARK_PEER_SAME_SCHOOL, round: true, label: 'Same school' }] : []),
          { color: MARK_PEER, round: true, label: 'Others' },
          ...(reg ? [{ color: GUIDE_STRONG.stroke, dashed: true, label: 'Tenure-expected pay' }] : []),
        ]}
      />

      {/* This was the only chart in the app with no source line, no CSV and no data table — including
          as an exhibit inside the printed report brief, where a figure with no numbers behind it is
          exactly the thing a reader is entitled to check. Tenure is rounded here because a point on a
          scatter is not a 15-decimal measurement; the CSV keeps the raw value. */}
      <ChartData
        caption={`Pay vs. tenure — ${titleLabel}`}
        columns={['Name', 'Tenure (yrs)', 'Pay']}
        rows={[...points]
          .sort((a, b) => b.pay - a.pay)
          .map((p) => [p.isSelf ? `${p.name} (this person)` : p.name, Number(p.tenure.toFixed(1)), p.pay])}
        n={points.length}
        unit="people"
      />
    </div>
  );
}

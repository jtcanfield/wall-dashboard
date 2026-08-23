import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import uPlot from 'uplot';
import type { AlignedData } from 'uplot';
import type { FxPoint } from '@shared/types';

interface Props {
  points: FxPoint[];
  color: string;
}

/**
 * ECB-sourced rates are business-day only, so a month of data has weekend
 * gaps. A stepped path holds Friday's rate flat across Saturday and Sunday,
 * which is what actually happened — a straight diagonal would invent movement.
 */
const stepped = uPlot.paths.stepped?.({ align: 1 });

export function Sparkline({ points, color }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<uPlot | null>(null);

  const data = useMemo<AlignedData>(
    () => [points.map((p) => Date.parse(p.date) / 1000), points.map((p) => p.rate)],
    [points],
  );

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const u = new uPlot(
      {
        width: el.clientWidth,
        height: el.clientHeight,
        cursor: { show: false },
        legend: { show: false },
        padding: [4, 2, 4, 2],
        scales: { x: { time: true } },
        axes: [{ show: false }, { show: false }],
        series: [{}, { stroke: color, width: 2, paths: stepped }],
      },
      data,
      el,
    );
    chart.current = u;
    return () => {
      u.destroy();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    chart.current?.setData(data);
  }, [data]);

  return <div class="fx__spark" ref={host} />;
}

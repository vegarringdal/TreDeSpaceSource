import { CopyButton, Link, ProgressBar, Spinner, Swatch, Vec3Input } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { Section } from './Section';

const PALETTE = ['#e11d48', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];

/** Gallery section for the small single-purpose widgets. */
export function SmallPartsDemo() {
  const [pick, setPick] = useState(PALETTE[3]);
  const [center, setCenter] = useState<[number, number, number]>([12.5, -3, 0.25]);
  const [progress, setProgress] = useState(0.15);

  useEffect(() => {
    const t = setInterval(() => setProgress((p) => (p >= 1 ? 0 : +(p + 0.05).toFixed(2))), 400);
    return () => clearInterval(t);
  }, []);

  return (
    <Section
      title="Link / Swatch / Spinner / CopyButton / Vec3Input"
      note="The small single-purpose parts. Link gives every out-of-app link one look (new tab, noreferrer). Swatch is a colour chip — clickable in a palette, static as a read-out. Spinner and ProgressBar are the busy indicators the loading dialog is built from. CopyButton owns its own “Copied” confirmation, so no panel hand-rolls that timer. Vec3Input is three steppers on one row for a point, a size or an axis."
      props={['LinkProps', 'SwatchProps', 'SpinnerProps', 'ProgressBarProps', 'CopyButtonProps', 'Vec3InputProps']}
      code={`function ShapeEditor({ shape, onChange }) {
  return (
    <>
      <Vec3Input label="Center" value={shape.center}
        onChange={(center) => onChange({ center })} />
      <div className="flex gap-1">
        {PALETTE.map((c) => (
          <Swatch key={c} color={c} active={c === shape.color}
            onClick={() => onChange({ color: c })} />
        ))}
      </div>
      <CopyButton value={() => JSON.stringify(shape)}>Copy JSON</CopyButton>
    </>
  );
}`}
    >
      <div className="flex flex-col gap-4">
        <Vec3Input label="Center" value={center} onChange={setCenter} unit="m" />

        <div className="flex items-center gap-2">
          <span className="w-12 text-slate-400">Colour</span>
          {PALETTE.map((c) => (
            <Swatch key={c} color={c} active={c === pick} tooltip={c} onClick={() => setPick(c)} />
          ))}
          <Swatch color={pick} size={22} />
        </div>

        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-slate-400">Cooking…</span>
          <div className="min-w-0 flex-1">
            <ProgressBar value={progress} />
          </div>
        </div>
        <ProgressBar />

        <div className="flex items-center gap-2">
          <CopyButton value={() => JSON.stringify({ center, pick })}>Copy JSON</CopyButton>
          <CopyButton iconOnly value="1024" tooltip="Copy the value" />
          <Link href="https://example.com/docs">Read the docs</Link>
        </div>
      </div>
    </Section>
  );
}

import { Button, Collapsible, NumberInput, RadioGroup } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { residency } from '../../../../state/viewer/residency';
import { getRenderer, viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';

const swapSpeeds = [
  { value: 'relaxed', label: 'Relaxed', hint: 'one swap at a time', shortcut: 'render.vramSwap.relaxed' },
  { value: 'normal', label: 'Normal', hint: 'balanced', shortcut: 'render.vramSwap.normal' },
  { value: 'fast', label: 'Fast', hint: 'shortest idle wait', shortcut: 'render.vramSwap.fast' },
];

const COPIED_RESET_MS = 1200;

/** Rendering → VRAM budget: max GPU memory footprint (0 = off). */
export function VramBudgetSection() {
  const v = useViewer();
  const act = viewerActions;
  const [copied, setCopied] = useState(false);

  const handleCopyLog = () => {
    void navigator.clipboard?.writeText(residency.debugDump(getRenderer())).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  };

  return (
    <Collapsible
      title="VRAM budget"
      info={
        <>
          0 = off (default): everything loads at full detail, nothing ever swaps. With a budget set, models far from the
          camera drop to a coarse variant (or unload, for assets imported before coarse variants existed) while the
          camera stands still, and come back to full detail when you move close and stop.
          <br />
          <br />
          <strong>Set it too low and geometry you are looking at will be missing</strong> — the budget is a hard
          ceiling, so when even the visible zones do not fit, parts of them stay coarse or never load at all. Use it
          only when you need it: a weak or low-memory GPU, or a model too large to fit. On a strong PC, or for any model
          that fits comfortably, leave it off — it can only cost detail, never add it.
        </>
      }
    >
      <Row label="Max VRAM">
        <NumberInput
          value={v.maxVramMb}
          min={0}
          max={65536}
          step={256}
          unit="MB"
          decShortcut="render.maxVram.dec"
          incShortcut="render.maxVram.inc"
          onChange={(x) => act.update({ maxVramMb: x })}
        />
      </Row>
      <RadioGroup
        options={swapSpeeds}
        value={v.vramSwapSpeed}
        onChange={(x) => act.update({ vramSwapSpeed: x === 'relaxed' || x === 'fast' ? x : 'normal' })}
      />
      <Row label="Cut size">
        <NumberInput
          value={v.vramCutSizeM}
          min={0}
          max={10}
          step={0.1}
          precision={1}
          unit="m"
          decShortcut="render.vramCutSize.dec"
          incShortcut="render.vramCutSize.inc"
          onChange={(x) => act.update({ vramCutSizeM: x })}
        />
      </Row>
      <Row label="Cut distance">
        <NumberInput
          value={v.vramCutDistM}
          min={0}
          step={25}
          unit="m"
          decShortcut="render.vramCutDist.dec"
          incShortcut="render.vramCutDist.inc"
          onChange={(x) => act.update({ vramCutDistM: x })}
        />
      </Row>
      <Check
        label="Drop hidden items"
        tooltip="Hidden items are dropped from budget packs entirely — their VRAM goes to visible detail instead; they re-pack in when unhidden"
        shortcut="render.vramDropHidden"
        checked={v.vramDropHidden}
        onChange={(x) => act.update({ vramDropHidden: x })}
      />
      <Check
        label="Show activity indicator"
        tooltip="Small top-right viewport chip while the budget is active: blue = swapping, green check = settled (done what's possible for this spot), grey = waiting for the camera to rest"
        shortcut="render.vramActivityHud"
        checked={v.vramActivityHud}
        onChange={(x) => act.update({ vramActivityHud: x })}
      />
      <Check
        label="Show residency boxes"
        tooltip="Debug: draw each zone's visible-bounds box colored by residency — green full, purple mixed (near items sharp), orange coarse, red unloaded, blue while swapping"
        shortcut="render.vramBoxes"
        checked={v.vramDebugBoxes}
        onChange={(x) => act.update({ vramDebugBoxes: x })}
      />
      <div className="flex gap-1.5">
        <Button
          className="h-6 px-2 text-[11px]"
          tooltip="Copy the current per-zone residency state and the recent swap events (with reasons) to the clipboard"
          shortcut="render.vramCopyLog"
          onClick={handleCopyLog}
        >
          {copied ? 'Copied' : 'Copy event log'}
        </Button>
        <Button className="h-6 px-2 text-[11px]" tooltip="Clear the residency event log" onClick={residency.clearLog}>
          Clear
        </Button>
      </div>
    </Collapsible>
  );
}

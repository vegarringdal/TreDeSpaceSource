import { NumberInput, SegmentedControl, Select } from '@treDeSpaceUI/widgets';
import type { Scene, Step, StepCard } from '../../../lib/animation/types';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../../../lib/overlay/overlayStyle';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { findComponent } from '../../../state/animation/runtimeOverlay';
import { stepsActions } from '../../../state/animation/steps.actions';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { useOverlayThemeOptions } from '../shared/useOverlayThemeOptions';
import { PIN_OPTIONS } from './OverlayAnchorFields';
import { OverlayValueFields } from './OverlayValueFields';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const LABEL_W = 56;

const WHICH = [
  {
    value: 'scene',
    label: 'Scene card',
    tooltip: "The scene's step card (Key panel → scene)",
    shortcut: 'animation.step.card.scene',
  },
  {
    value: 'own',
    label: 'Own',
    tooltip: 'A card of its own: a design and its values',
    shortcut: 'animation.step.card.own',
  },
  { value: 'none', label: 'None', tooltip: 'No card for this step', shortcut: 'animation.step.card.none' },
] as const;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const whichOf = (card: Step['card']) => (card === undefined ? 'scene' : card === null ? 'none' : 'own');

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------

/** A step's card: the scene's, its own (design, values, place, text size,
 *  theme) or none. */
export function StepCardFields({ scene, step }: { scene: Scene; step: Step }) {
  const lib = overlayLibraryState.use();
  const themes = useOverlayThemeOptions();
  const doc = animationDocState.use().doc;
  const card = step.card;
  const set = (patch: Partial<StepCard>, coalesce?: string) =>
    card && stepsActions.setCard(step.id, { ...card, ...patch }, coalesce);

  const handleWhich = (w: (typeof WHICH)[number]['value']) => {
    if (w === 'scene') {
      stepsActions.setCard(step.id, undefined);
    } else if (w === 'none') {
      stepsActions.setCard(step.id, null);
    } else {
      stepsActions.setCard(step.id, { component: scene.stepCard?.component ?? 'preset.stepCard', values: {} });
    }
  };
  const comp = card ? findComponent(doc, card.component) : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
          Card
        </span>
        <SegmentedControl size="sm" grow value={whichOf(card)} options={WHICH} onChange={handleWhich} />
      </div>
      {card && (
        <>
          <Select
            tooltip="The card's design"
            label="Design"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={card.component}
            options={lib.components.map((c) => ({ value: c.id, label: c.name }))}
            clearable={false}
            onChange={(component) => component && set({ component })}
          />
          {comp && (
            <OverlayValueFields
              component={comp}
              values={card.values}
              onChange={(k, v) => set({ values: { ...card.values, [k]: v } }, `step-card:${step.id}:${k}`)}
            />
          )}
          <Select
            tooltip="Where on screen the card sits"
            label="Place"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={card.place ?? 'bl'}
            options={PIN_OPTIONS}
            clearable={false}
            onChange={(place) => place && set({ place })}
          />
          <NumberInput
            tooltip="Every text on the card this many times its designed size"
            decShortcut="animation.step.cardText.dec"
            incShortcut="animation.step.cardText.inc"
            label="Text size"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={card.textScale ?? 1}
            min={TEXT_SCALE_MIN}
            max={TEXT_SCALE_MAX}
            step={0.05}
            unit="×"
            onChange={(textScale) => set({ textScale }, `step-card-text:${step.id}`)}
          />
          <Select
            tooltip="The card's colour theme — Auto follows the app's light / dark theme"
            label="Theme"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={themes.toValue(card.theme)}
            options={themes.options}
            clearable={false}
            onChange={(v) => set({ theme: themes.fromValue(v) ?? undefined })}
          />
        </>
      )}
    </div>
  );
}

import { IconDownload, IconPlayerPlay, IconPlus, IconUpload } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, Collapsible, readFileText, Select, useFilePicker } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { MultiColorCtx, MultiColorProvider } from './multiColorContext';
import { RuleEditor } from './RuleEditor';
import { Tip } from './Tip';

export { MultiColorProvider };

const MODE_OPTIONS = [
  { value: 'reset', label: 'Reset model' },
  { value: 'append', label: 'Append only' },
  { value: 'hide', label: 'Hide model' },
];

/** MultiColor: a sequenced list of filter+color rules applied to the whole
 *  model in order — bulk coloring driven by names / pasted tag lists. */
export function MultiColor() {
  useMinSize(280, 260);
  const { store, act } = useContext(MultiColorCtx);
  const s = store.use();
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 p-2">
      <div className="shrink-0">
        <Collapsible
          title="Common"
          info={
            <>
              Rules run top to bottom. Filters find items by name; <b>Default</b> colour / opacity 1 restore the
              original mesh look. Mode <b>Reset model</b> clears existing overrides before running; <b>Append only</b>{' '}
              layers on top; <b>Hide model</b> hides everything first — the rules unhide and colour only what they
              match. Save/Load stores the rule set as JSON.
            </>
          }
        >
          <div className="flex items-center gap-1.5">
            <Tip
              className="min-w-0 flex-1"
              tip="Reset model clears every existing color/opacity override before the rules run; Append only layers the rules on top of what is already colored; Hide model hides EVERYTHING first — the rules unhide and color only what they match"
            >
              <Select
                options={MODE_OPTIONS}
                value={s.mode}
                onChange={(v) => act.setMode(v as 'reset' | 'append' | 'hide')}
              />
            </Tip>
            <Button
              icon={<IconPlus size={14} />}
              tooltip="Add a new rule to the end of the sequence"
              shortcut="multiColor.addRule"
              onClick={act.addRule}
            >
              Rule
            </Button>
            <Button
              icon={<IconPlayerPlay size={14} />}
              disabled={s.running || s.rules.every((r) => !r.enabled)}
              tooltip="Run all enabled rules in order"
              shortcut="multiColor.run"
              onClick={() => void act.run()}
            >
              Run
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              icon={<IconDownload size={14} />}
              tooltip="Save the rule set (mode + rules) to a JSON file"
              shortcut="multiColor.save"
              onClick={act.saveToFile}
            >
              Save
            </Button>
            <Button
              icon={<IconUpload size={14} />}
              tooltip="Load a rule set from a JSON file (replaces the current rules)"
              shortcut="multiColor.load"
              onClick={picker.open}
            >
              Load
            </Button>
            {picker.element}
          </div>
        </Collapsible>
      </div>

      {/* only the RULES scroll — Common above stays visible however many rules */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {s.rules.map((rule, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional
          <RuleEditor key={i} idx={i} rule={rule} count={s.counts[i] ?? null} total={s.rules.length} />
        ))}
      </div>
    </PanelBody>
  );
}

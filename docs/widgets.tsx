// widgets.tsx — the /docs/ live gallery of @treDeSpaceUI.
// Imports ONLY the library (and this page's own stylesheet): if a widget
// renders broken here it secretly depends on an app style — see widgets.css.
// Each section shows a live demo, a complete usage snippet (a small stateful
// component, so the wiring is visible), and a props reference generated from
// the library sources by scripts/gen-widget-docs.mjs (no drift).
// The demo sections live one-per-file in ./gallery/.
import { initTooltips, VerticalTabs } from '@treDeSpaceUI/widgets';
import { createRoot } from 'react-dom/client';
import { ButtonDemo } from './gallery/ButtonDemo';
import { CheckboxDemo } from './gallery/CheckboxDemo';
import { CollapsibleDemo } from './gallery/CollapsibleDemo';
import { ColorSelectDemo } from './gallery/ColorSelectDemo';
import { DatePickerDemo } from './gallery/DatePickerDemo';
import { DateTimePickerDemo } from './gallery/DateTimePickerDemo';
import { DialogsDemo } from './gallery/DialogsDemo';
import { DockDemo } from './gallery/DockDemo';
import { FilePickerDemo } from './gallery/FilePickerDemo';
import { FileTreeDemo } from './gallery/FileTreeDemo';
import { HotkeysDemo } from './gallery/HotkeysDemo';
import { InfoDemo } from './gallery/InfoDemo';
import { InlinePanelDemo } from './gallery/InlinePanelDemo';
import { NumberInputDemo } from './gallery/NumberInputDemo';
import { PackageCard } from './gallery/PackageCard';
import { RadioGroupDemo } from './gallery/RadioGroupDemo';
import { RibbonDemo } from './gallery/RibbonDemo';
import { SelectDemo } from './gallery/SelectDemo';
import { SqlEditorDemo } from './gallery/SqlEditorDemo';
import { TextFieldDemo } from './gallery/TextFieldDemo';
import { TimePickerDemo } from './gallery/TimePickerDemo';
import { TooltipDemo } from './gallery/TooltipDemo';
import { VerticalTabsDemo } from './gallery/VerticalTabsDemo';
import './theme';
import './widgets.css';

initTooltips();

const GALLERY = [
  { id: 'button', label: 'Button', content: <ButtonDemo /> },
  { id: 'textfield', label: 'TextField', content: <TextFieldDemo /> },
  { id: 'number', label: 'NumberInput', content: <NumberInputDemo /> },
  { id: 'select', label: 'Select', content: <SelectDemo /> },
  { id: 'date', label: 'DatePicker', content: <DatePickerDemo /> },
  { id: 'time', label: 'TimePicker', content: <TimePickerDemo /> },
  { id: 'datetime', label: 'DateTimePicker', content: <DateTimePickerDemo /> },
  { id: 'radio', label: 'RadioGroup', content: <RadioGroupDemo /> },
  { id: 'checkbox', label: 'Checkbox', content: <CheckboxDemo /> },
  { id: 'color', label: 'ColorSelect', content: <ColorSelectDemo /> },
  { id: 'collapsible', label: 'Collapsible', content: <CollapsibleDemo /> },
  { id: 'inline', label: 'InlinePanel', content: <InlinePanelDemo /> },
  { id: 'info', label: 'InfoBox', content: <InfoDemo /> },
  { id: 'vtabs', label: 'VerticalTabs', content: <VerticalTabsDemo /> },
  { id: 'filetree', label: 'FileTree', content: <FileTreeDemo /> },
  { id: 'sql', label: 'SqlCodeEditor', content: <SqlEditorDemo /> },
  { id: 'dialogs', label: 'Dialogs', content: <DialogsDemo /> },
  { id: 'tooltip', label: 'Tooltips', content: <TooltipDemo /> },
  { id: 'hotkeys', label: 'Hotkeys', content: <HotkeysDemo /> },
  { id: 'picker', label: 'useFilePicker', content: <FilePickerDemo /> },
  { id: 'ribbon', label: 'Ribbon', content: <RibbonDemo /> },
  { id: 'dock', label: 'Dockable', content: <DockDemo /> },
];

/** Page shell: the package download card, then every widget demo in a vertical-tab gallery. */
function Gallery() {
  return (
    <>
      <PackageCard />
      <div className="mb-16 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 font-sans text-[12px] text-slate-200 leading-[1.45] shadow-lg">
        <VerticalTabs className="h-[720px]" tabs={GALLERY} />
      </div>
    </>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  rootEl.textContent = '';
  createRoot(rootEl).render(<Gallery />);
}

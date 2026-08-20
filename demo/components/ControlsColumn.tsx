import { Button } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { useDemo } from '../DemoContext';
import { IS_DIALOG } from '../hostEnv';
import { AppSection } from '../sections/AppSection';
import { ClipSection } from '../sections/ClipSection';
import { ColorRulesSection } from '../sections/ColorRulesSection';
import { EventsSection } from '../sections/EventsSection';
import { ExternalAppsSection } from '../sections/ExternalAppsSection';
import { InstanceSection } from '../sections/InstanceSection';
import { LabelsSection } from '../sections/LabelsSection';
import { MeasurementsSection } from '../sections/MeasurementsSection';
import { ModelStoresSection } from '../sections/ModelStoresSection';
import { NavigationSection } from '../sections/NavigationSection';
import { SelectionSection } from '../sections/SelectionSection';
import { SqlSection } from '../sections/SqlSection';
import { ViewpointsSection } from '../sections/ViewpointsSection';
import { Hint } from './Hint';
import { Row } from './Row';

function ModeLine() {
  if (IS_DIALOG) {
    return (
      <Hint>
        Dialog mode — driving the parent viewer.{' '}
        <a href="./" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
          Standalone iframe demo
        </a>
      </Hint>
    );
  }

  return (
    <Hint>
      Iframe mode.{' '}
      <a href="?dialog=1" className="text-sky-400 hover:underline">
        Switch to dialog mode
      </a>
    </Hint>
  );
}

/** The left action column: page intro, log controls and every API section. */
export function ControlsColumn() {
  const { clearLog } = useDemo();
  const [collapseNonce, setCollapseNonce] = useState(0);

  return (
    <div
      className={`flex flex-col gap-2 overflow-y-auto p-2.5 ${
        IS_DIALOG ? 'min-h-0 w-full flex-1' : 'w-[340px] flex-none border-slate-800 border-r'
      }`}
    >
      <h1 className="m-0 font-semibold text-[13px]">TreDeSpace postMessage API demo</h1>
      <Hint>
        The app runs in the iframe on the right; every button posts a command through the copy-paste SDK (
        <code>api/tredespace-client.ts</code>) and logs the full request/response below — including <code>missed</code>{' '}
        fullnames for things the app could not find.
      </Hint>
      <ModeLine />
      <Row>
        <Button onClick={clearLog}>Clear log</Button>
        <Button onClick={() => setCollapseNonce((n) => n + 1)}>Collapse all</Button>
      </Row>
      {/* sections mount collapsed; bumping the key remounts them all closed */}
      <div key={collapseNonce} className="flex flex-col gap-2">
        <EventsSection />
        <SelectionSection />
        <LabelsSection />
        <ColorRulesSection />
        <NavigationSection />
        <ClipSection />
        <InstanceSection />
        <MeasurementsSection />
        <ViewpointsSection />
        <AppSection />
        <ModelStoresSection />
        <SqlSection />
        <ExternalAppsSection />
      </div>
    </div>
  );
}

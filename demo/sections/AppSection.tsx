import { Button } from '@treDeSpaceUI/widgets';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

export function AppSection() {
  const { run, c } = useDemo();

  const handleLoadingShow = () =>
    void run('ui.loading.show', { header: 'Please wait', title: 'Demo loading…' }, () =>
      c().uiLoadingShow({ header: 'Please wait', title: 'Demo loading…' }),
    );

  const handleConfirm = () =>
    void run('ui.confirm', { question: 'Proceed with the demo action?' }, () =>
      c().uiConfirm({ header: 'Confirm', question: 'Proceed with the demo action?', yes: 'Do it', no: 'Cancel' }),
    );

  const handleError = () =>
    void run('ui.error', { title: 'Something went wrong (demo)' }, () =>
      c().uiError({ header: 'Demo error', title: 'Something went wrong (demo)' }),
    );

  return (
    <DemoSection title="App">
      <Row>
        <Button onClick={() => void run('settings.get', {}, () => c().settingsGet())}>settings.get</Button>
        <Button onClick={() => void run('ui.kiosk', { on: true }, () => c().uiKiosk(true))}>ui.kiosk on</Button>
        <Button onClick={() => void run('ui.kiosk', { on: false }, () => c().uiKiosk(false))}>ui.kiosk off</Button>
        <Button onClick={() => void run('ui.kiosk', {}, () => c().uiKiosk())}>ui.kiosk get</Button>
        <Button onClick={() => void run('ui.close', {}, () => c().uiClose())}>ui.close (close my dialog)</Button>
      </Row>
      <Row>
        <Button onClick={() => void run('ui.showPanel', { panel: 'hierarchy' }, () => c().uiShowPanel('hierarchy'))}>
          ui.showPanel (hierarchy)
        </Button>
        <Button onClick={() => void run('ui.hidePanel', { panel: 'hierarchy' }, () => c().uiHidePanel('hierarchy'))}>
          ui.hidePanel (hierarchy)
        </Button>
      </Row>
      <Row>
        <Button onClick={handleLoadingShow}>ui.loading.show</Button>
        <Button onClick={() => void run('ui.loading.hide', {}, () => c().uiLoadingHide())}>ui.loading.hide</Button>
        <Button onClick={handleConfirm}>ui.confirm</Button>
        <Button onClick={handleError}>ui.error</Button>
      </Row>
    </DemoSection>
  );
}

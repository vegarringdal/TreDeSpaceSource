import { definePanel, type PanelDefinition } from '@treDeSpaceUI/dockable';
import { ClipShapes } from './components/panels/clip-shapes/ClipShapes';
import { Console } from './components/panels/console/Console';
import { Export } from './components/panels/export/Export';
import { Hierarchy } from './components/panels/hierarchy/Hierarchy';
import { ImportManager } from './components/panels/import-manager/ImportManager';
import { Labels } from './components/panels/labels/Labels';
import { Measurements } from './components/panels/measurements/Measurements';
import { ModelAssets } from './components/panels/model-assets/ModelAssets';
import { MultiColor } from './components/panels/multi-color/MultiColor';
import { QuickColors } from './components/panels/quick-colors/QuickColors';
import { RibbonClippingBox } from './components/panels/ribbon-clipping-box/RibbonClippingBox';
import { RibbonClippingPlane } from './components/panels/ribbon-clipping-plane/RibbonClippingPlane';
import { RibbonExternal } from './components/panels/ribbon-external/RibbonExternal';
import { RibbonHome } from './components/panels/ribbon-home/RibbonHome';
import { RibbonLayout } from './components/panels/ribbon-layout/RibbonLayout';
import { RibbonMeasurements } from './components/panels/ribbon-measurements/RibbonMeasurements';
import { RibbonPad } from './components/panels/ribbon-pad/RibbonPad';
import { RibbonPanels } from './components/panels/ribbon-panels/RibbonPanels';
import { RibbonSelectionColor } from './components/panels/ribbon-selection-color/RibbonSelectionColor';
import { RibbonSelectionTransform } from './components/panels/ribbon-selection-transform/RibbonSelectionTransform';
import { Settings } from './components/panels/settings/Settings';
import { SqlAssets } from './components/panels/sql-assets/SqlAssets';
import { SqlDetail } from './components/panels/sql-detail/SqlDetail';
import { SqlEditor } from './components/panels/sql-editor/SqlEditor';
import { SqlReports } from './components/panels/sql-reports/SqlReports';
import { SqlTable } from './components/panels/sql-table/SqlTable';
import { Viewpoints } from './components/panels/viewpoints/Viewpoints';
import {
  LabelsViewpoint,
  MeasurementsViewpoint,
  MultiColorViewpoint,
} from './components/panels/viewpoints/ViewpointVariants';
import { ViewpointViewer } from './components/panels/viewpoints/ViewpointViewer';
import { viewport } from './components/panels/viewport/viewport';

const ribbon = { dockableIn: 'top', tabMinWidth: 96, closable: false } as const;

/** Every dock panel the app knows: the ribbon strip, the tool panels, and the
 *  non-React viewport. Order defines ribbon tab order. */
export const panels: PanelDefinition[] = [
  // The ribbon strip: pinned to the node with id 'top', reorder-only.
  definePanel({ id: 'ribbonHome', title: 'Home', ...ribbon, component: RibbonHome }),
  definePanel({ id: 'ribbonClippingPlane', title: 'Clipping Plane', ...ribbon, component: RibbonClippingPlane }),
  definePanel({ id: 'ribbonClippingBox', title: 'Clipping Box', ...ribbon, component: RibbonClippingBox }),
  definePanel({ id: 'ribbonSelectionColor', title: 'Selection Color', ...ribbon, component: RibbonSelectionColor }),
  definePanel({ id: 'ribbonSelectionTransform', title: 'Transform', ...ribbon, component: RibbonSelectionTransform }),
  definePanel({ id: 'ribbonMeasurements', title: 'Measurements', ...ribbon, component: RibbonMeasurements }),
  definePanel({ id: 'ribbonPanels', title: 'Panels', ...ribbon, component: RibbonPanels }),
  definePanel({ id: 'ribbonLayout', title: 'Layout', ...ribbon, component: RibbonLayout }),
  definePanel({ id: 'ribbonExternal', title: 'External', ...ribbon, component: RibbonExternal }),
  definePanel({ id: 'ribbonPad', title: 'Pad', ...ribbon, component: RibbonPad }),

  definePanel({ id: 'hierarchy', title: 'Hierarchy', home: 'left', component: Hierarchy }),
  // opened on demand from the Selection Color ribbon (Edit) — not in the layout
  definePanel({ id: 'quickColors', title: 'Color Panel', home: 'left', component: QuickColors }),
  definePanel({ id: 'console', title: 'Console', home: 'bottom', component: Console }),
  definePanel({ id: 'settings', title: 'Settings', home: 'right', component: Settings }),
  definePanel({ id: 'measurements', title: 'Measurements', home: 'right', component: Measurements }),
  definePanel({ id: 'clipShapes', title: 'Clip Shapes', home: 'right', component: ClipShapes }),
  definePanel({ id: 'modelAssets', title: 'Model Assets', home: 'left', component: ModelAssets }),
  // opened on demand — not part of the default layout
  definePanel({ id: 'sqlAssets', title: 'SQL Assets', home: 'left', component: SqlAssets }),
  definePanel({ id: 'sqlEditor', title: 'SQL Editor', home: 'bottom', component: SqlEditor }),
  definePanel({ id: 'sqlReports', title: 'SQL Reports', home: 'left', component: SqlReports }),
  definePanel({ id: 'sqlTable', title: 'SQL Table', home: 'bottom', component: SqlTable }),
  definePanel({ id: 'sqlDetail', title: 'SQL Detail', home: 'right', component: SqlDetail }),
  definePanel({ id: 'multiColor', title: 'Set Color', home: 'right', component: MultiColor }),
  definePanel({ id: 'labels', title: 'Labels', home: 'right', component: Labels }),
  definePanel({ id: 'importManager', title: 'Import Manager', home: 'right', component: ImportManager }),
  definePanel({ id: 'export', title: 'Export', home: 'right', component: Export }),
  definePanel({ id: 'viewpoints', title: 'Viewpoints', home: 'right', component: Viewpoints }),
  definePanel({ id: 'viewpointViewer', title: 'Viewpoint Viewer', home: 'left', component: ViewpointViewer }),
  definePanel({ id: 'labelsViewpoint', title: 'Labels (viewpoint)', home: 'right', component: LabelsViewpoint }),
  definePanel({
    id: 'measurementsViewpoint',
    title: 'Measurements (viewpoint)',
    home: 'right',
    component: MeasurementsViewpoint,
  }),
  definePanel({
    id: 'multiColorViewpoint',
    title: 'Set Color (viewpoint)',
    home: 'right',
    component: MultiColorViewpoint,
  }),

  viewport, // plain DOM + three.js, no React
];

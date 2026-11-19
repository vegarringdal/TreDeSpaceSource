// The slice of the WebHID API (https://wicg.github.io/webhid/) the SpaceMouse
// reader uses. TypeScript's DOM lib does not ship WebHID yet; declaring the few
// members here keeps a types package (and its notice) out of the dependencies.

export type HidCollectionInfo = Readonly<{
  usagePage: number;
  usage: number;
}>;

export interface HidDevice extends EventTarget {
  readonly opened: boolean;
  readonly productName: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly collections: readonly HidCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  /** Revokes the permission (Chrome 100+), so the device is not re-opened on the next visit. */
  forget?(): Promise<void>;
}

export interface HidInputReportEvent extends Event {
  readonly device: HidDevice;
  readonly reportId: number;
  readonly data: DataView;
}

export interface HidConnectionEvent extends Event {
  readonly device: HidDevice;
}

export type HidDeviceFilter = Readonly<{
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}>;

export interface Hid extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: Readonly<{ filters: readonly HidDeviceFilter[] }>): Promise<HidDevice[]>;
}

declare global {
  interface Navigator {
    /** WebHID — present in Chromium browsers on secure origins only. */
    readonly hid?: Hid;
  }
}

/** Narrows a WebHID event to an input report (the listener API hands out plain Events). */
export function isInputReportEvent(e: Event): e is HidInputReportEvent {
  return 'reportId' in e && 'data' in e && e.data instanceof DataView;
}

/** Narrows a WebHID event to a connect/disconnect event. */
export function isConnectionEvent(e: Event): e is HidConnectionEvent {
  return 'device' in e && !('reportId' in e);
}

export class LogCollector {
  #logs: string[] = [];
  #startTime: number = 0;
  #startTimeFirst: number = 0;
  #enabled: boolean;
  #debugPrint: boolean;
  #id: number;
  #lastLog: number;
  #name: string;

  constructor(
    id: number,
    name: string,
    enabled: boolean = false,
    debugPrint: boolean = false,
    timeAbsolute: readonly [number, number],
  ) {
    this.#id = id;
    this.#name = name.padEnd(10, ' ');
    this.#startTimeFirst = timeAbsolute[0] - performance.timeOrigin;
    this.#startTime = this.#startTimeFirst;
    this.#lastLog = timeAbsolute[1] - performance.timeOrigin;
    this.#enabled = enabled;
    this.#debugPrint = debugPrint;
  }

  /**
   *
   * @returns [startTime, lastLogTime]
   */
  transferAbsoluteLogTimes() {
    return [this.#startTimeFirst + performance.timeOrigin, this.#lastLog + performance.timeOrigin] as const;
  }

  log(msg: string) {
    if (!this.#enabled && !this.#debugPrint) {
      return;
    }

    const timePast = (performance.now() - this.#startTime).toFixed(0).padStart(4, '0');
    const timeOffset = (performance.now() - this.#lastLog).toFixed(0).padStart(4, '0');

    this.#lastLog = performance.now();

    const logMsg = `${this.#name} - ${timePast} ms [${timeOffset}]  - ${msg}`;

    if (this.#enabled) {
      this.#logs.push(logMsg);
    }

    if (this.#debugPrint) {
      console.log(this.#id, logMsg);
    }
  }

  getResult() {
    return {
      logs: this.#logs,
      startTime: this.#startTime,
      executeTime: performance.now() - this.#startTime,
    };
  }
}

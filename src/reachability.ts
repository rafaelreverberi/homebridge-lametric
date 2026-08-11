export interface ReachabilityLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

export class DeviceCommunicationError extends Error {}

export function throwUnlessDeviceCommunicationError(error: unknown): void {
  if (!(error instanceof DeviceCommunicationError)) {
    throw error;
  }
}

export class ReachabilityLogGate {
  private unavailable = false;
  private nextRetryAt = 0;

  constructor(
    private readonly log: ReachabilityLogger,
    private readonly deviceAddress: string,
    private readonly retryIntervalMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  beginAttempt(): boolean {
    if (!this.unavailable) {
      return true;
    }

    const currentTime = this.now();
    if (currentTime < this.nextRetryAt) {
      return false;
    }

    // Reserve the next retry window so concurrent HomeKit reads only trigger
    // one probe while the device is unavailable.
    this.nextRetryAt = currentTime + this.retryIntervalMs;
    return true;
  }

  reportFailure(error: unknown): string {
    const detail = this.describe(error);

    if (!this.unavailable) {
      this.log.warn(
        `LaMetric device ${this.deviceAddress} is not reachable: ${detail} `
        + 'Further connection errors will be hidden until the device is reachable again.',
      );
    } else {
      this.log.debug(`LaMetric device ${this.deviceAddress} is still not reachable: ${detail}`);
    }

    this.unavailable = true;
    this.nextRetryAt = this.now() + this.retryIntervalMs;
    return detail;
  }

  reportSuccess(): void {
    if (this.unavailable) {
      this.log.info(`LaMetric device ${this.deviceAddress} is reachable again.`);
    }
    this.unavailable = false;
    this.nextRetryAt = 0;
  }

  private describe(error: unknown): string {
    if (error instanceof Error) {
      const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
      return `${error.message}${code}`;
    }
    return String(error);
  }
}

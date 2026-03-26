let nowProvider: () => number = () => Date.now();

export function nowMs(): number {
  return nowProvider();
}

export function nowDate(): Date {
  return new Date(nowMs());
}

export function nowIso(): string {
  return nowDate().toISOString();
}

export function __setNowProviderForTests(provider: () => number): void {
  nowProvider = provider;
}

export function __resetNowProviderForTests(): void {
  nowProvider = () => Date.now();
}

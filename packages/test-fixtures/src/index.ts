export interface SafeFixture<TPayload> {
  name: string;
  payload: TPayload;
  source: 'synthetic';
}

export function defineSafeFixture<TPayload>(
  name: string,
  payload: TPayload,
): SafeFixture<TPayload> {
  return {
    name,
    payload,
    source: 'synthetic',
  };
}

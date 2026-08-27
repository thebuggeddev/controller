export type Phase = 'loading' | 'intro' | 'idle' | 'transitioning';

export interface State {
  index: number;
  previousIndex: number;
  /** +1 when advancing forwards through the carousel, -1 when going back. */
  direction: 1 | -1;
  phase: Phase;
  menuOpen: boolean;
}

type Listener = (state: State, prev: State) => void;

const state: State = {
  index: 0,
  previousIndex: 0,
  direction: 1,
  phase: 'loading',
  menuOpen: false,
};

const listeners = new Set<Listener>();

export function getState(): Readonly<State> {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(patch: Partial<State>): void {
  const prev = { ...state };
  let changed = false;
  for (const key of Object.keys(patch) as (keyof State)[]) {
    if (state[key] !== patch[key]) {
      (state as unknown as Record<string, unknown>)[key] = patch[key];
      changed = true;
    }
  }
  if (!changed) return;
  for (const fn of listeners) fn(state, prev);
}

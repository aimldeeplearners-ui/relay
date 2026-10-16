import type { RelayApi } from '../shared/api';

declare global {
  interface Window {
    relay: RelayApi;
  }
}

export {};
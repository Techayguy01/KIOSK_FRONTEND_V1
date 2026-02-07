// contracts/backend.contract.ts is DEPRECATED in favor of Agent Authority
// Re-exporting the Single Source of Truth from the Agent
import { UiState } from '../agent/index';

export type { UiState as UIState };

export interface UIContextType {
  state: UiState;
  data: any; // Flexible metadata container
  emit: (type: string, payload?: any) => void;
  loading: boolean;
}
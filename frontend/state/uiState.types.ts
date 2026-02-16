// contracts/backend.contract.ts is DEPRECATED in favor of Agent Authority
// Re-exporting the Single Source of Truth from the Agent
import { UiState } from '../agent/index';
import { TenantPayload } from '../services/tenantContext';

export type { UiState as UIState };

export interface UIContextType {
  state: UiState;
  data: any; // Flexible metadata container
  transcript: string;
  emit: (type: string, payload?: any) => void;
  loading: boolean;
  tenantSlug: string;
  tenant: TenantPayload | null;
}

// contracts/backend.contract.ts is DEPRECATED in favor of Agent Authority
// Re-exporting the Single Source of Truth from the Agent
import { UiState } from '../agent/index';
import { TenantPayload } from '../services/tenantContext';

export type { UiState as UIState };

export type FullscreenGalleryToggleEvent = {
  type: 'TOGGLE_FULLSCREEN_GALLERY';
  isOpen: boolean;
};

export type FullscreenGalleryActionEvent =
  | { type: 'OPEN_FULLSCREEN_GALLERY' }
  | { type: 'CLOSE_FULLSCREEN_GALLERY' };

export type UIStrictEvent = FullscreenGalleryToggleEvent | FullscreenGalleryActionEvent;

type UIEmitFn = {
  (type: 'TOGGLE_FULLSCREEN_GALLERY', payload: { isOpen: boolean }): void;
  (type: string, payload?: any): void;
};

export interface UIData {
  isGalleryFullscreen?: boolean;
  [key: string]: any;
}

export interface UIContextType {
  state: UiState;
  data: UIData; // Flexible metadata container
  transcript: string;
  emit: UIEmitFn;
  loading: boolean;
  tenantSlug: string;
  tenant: TenantPayload | null;
  refreshTenant: () => Promise<void>;
}

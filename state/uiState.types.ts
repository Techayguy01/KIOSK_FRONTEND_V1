import { UIState } from '../contracts/backend.contract';

export type { UIState };

export interface UIContextType {
  state: UIState;
  data: any; // Flexible metadata container
  emit: (type: string, payload?: any) => void;
  loading: boolean;
}
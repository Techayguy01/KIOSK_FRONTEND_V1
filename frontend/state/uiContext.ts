import React, { createContext, useContext } from 'react';
import { UIContextType } from './uiState.types';

// Initial default context
const initialContext: UIContextType = {
  state: 'IDLE',
  data: {},
  transcript: '',
  emit: (_type: string, _payload?: any) => { throw new Error("Not Implemented: UIContext Provider missing"); },
  loading: false,
  tenantSlug: '',
  tenant: null,
  refreshTenant: async () => { throw new Error("Not Implemented: UIContext Provider missing"); },
};

export const UIContext = createContext<UIContextType>(initialContext);

export const useUIState = () => useContext(UIContext);

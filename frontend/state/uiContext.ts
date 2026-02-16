import React, { createContext, useContext } from 'react';
import { UIContextType } from './uiState.types';

// Initial default context
const initialContext: UIContextType = {
  state: 'IDLE',
  data: {},
  transcript: '',
  emit: () => { throw new Error("Not Implemented: UIContext Provider missing"); },
  loading: false,
  tenantSlug: 'grand-hotel',
  tenant: null,
};

export const UIContext = createContext<UIContextType>(initialContext);

export const useUIState = () => useContext(UIContext);

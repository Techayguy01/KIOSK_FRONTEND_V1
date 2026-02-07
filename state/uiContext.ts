import React, { createContext, useContext } from 'react';
import { UIContextType } from './uiState.types';

// Initial default context
const initialContext: UIContextType = {
  state: 'IDLE',
  data: {},
  emit: () => { throw new Error("Not Implemented: UIContext Provider missing"); },
  loading: false,
};

export const UIContext = createContext<UIContextType>(initialContext);

export const useUIState = () => useContext(UIContext);
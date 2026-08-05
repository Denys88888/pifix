import { useContext } from 'react';
import { SettingsContext, type SettingsContextValue } from '../contexts/SettingsContext';

export function usePlatformSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('usePlatformSettings must be used inside <SettingsProvider>');
  return context;
}

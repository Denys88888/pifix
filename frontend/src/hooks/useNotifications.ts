import { useContext } from 'react';
import { NotificationsContext } from '../contexts/NotificationsContext';

export function useNotifications() {
  return useContext(NotificationsContext);
}

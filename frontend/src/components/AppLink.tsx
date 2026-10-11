import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

/**
 * An in-app link with no `href`.
 *
 * A real link has an address, and iOS offers to open a held or force-pressed
 * link in Safari ("Open Link") — outside Pi Browser, where the app has no Pi
 * session and nothing works. Seen on a real iPhone on the bottom menu. Without
 * an address there is nothing for the system to open; the tap still navigates,
 * Enter still works for keyboards, and it keeps the <a> element so every style
 * written for links still applies.
 */
export function AppLink({ to, onClick, onKeyDown, children, ...rest }: Props): JSX.Element {
  const navigate = useNavigate();

  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) navigate(to);
  };

  const key = (event: KeyboardEvent<HTMLAnchorElement>) => {
    onKeyDown?.(event);
    if (!event.defaultPrevented && event.key === 'Enter') navigate(to);
  };

  return (
    <a role="link" tabIndex={0} onClick={go} onKeyDown={key} {...rest}>
      {children}
    </a>
  );
}

import { useEffect, useState } from 'react';

const EVENT = 'wefood:navigate';

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const sync = () => setLoc(location.pathname + location.search);
    window.addEventListener('popstate', sync);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(EVENT, sync); };
  }, []);
  return loc;
}

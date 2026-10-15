import { useSearchParams } from 'react-router-dom';

export type DollarMode = 'nominal' | 'real';

/**
 * Nominal or inflation-adjusted dollars, in the page's address (E12): `?dollars=real`, nominal without it. It was a
 * preference kept in the browser, so a choice made on one page opened the next in real dollars without a word, and
 * a link showed its reader nominal ones.
 */
export function useDollarMode(): [DollarMode, (m: DollarMode) => void] {
  const [params, setParams] = useSearchParams();
  const mode: DollarMode = params.get('dollars') === 'real' ? 'real' : 'nominal';
  const set = (m: DollarMode) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (m === 'real') n.set('dollars', 'real');
      else n.delete('dollars');
      return n;
    }, { replace: true });
  return [mode, set];
}

import { useEffect, useState } from 'react';
import { Loader, Group, Text, Transition } from '@mantine/core';
import { useIsFetching } from '@tanstack/react-query';

/**
 * Thin, indeterminate top progress bar shown whenever data is being fetched/parsed
 * in the background (most notably the first DuckDB-WASM init + Parquet load). It is
 * non-blocking — the rest of the UI stays visible and interactive — and only appears
 * after a short delay so fast queries don't cause a flash.
 */
export function GlobalLoadingBar() {
  const fetching = useIsFetching();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (fetching > 0) {
      const t = setTimeout(() => setShow(true), 200);
      return () => clearTimeout(t);
    }
    setShow(false);
    return undefined;
  }, [fetching]);

  return (
    <Transition mounted={show} transition="fade" duration={200}>
      {(style) => <div className="global-loading-bar" style={style} aria-hidden />}
    </Transition>
  );
}

/** Friendly inline loading state that keeps the surrounding page structure intact. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <Group justify="center" gap="sm" py={48} aria-live="polite">
      <Loader size="sm" />
      <Text size="sm" c="dimmed">{label}</Text>
    </Group>
  );
}

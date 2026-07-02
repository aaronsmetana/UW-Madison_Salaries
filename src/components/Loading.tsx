import { useEffect, useState } from 'react';
import { Loader, Group, Text, Transition, Alert, Button } from '@mantine/core';
import { IconAlertTriangle, IconWifiOff } from '@tabler/icons-react';
import { useIsFetching } from '@tanstack/react-query';
import { useDbReady, useSummary } from '../lib/hooks';

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

/** Global banner shown when the salary dataset (DuckDB/Parquet) or summary fails to load. */
export function DataErrorBanner() {
  const db = useDbReady();
  const summary = useSummary();
  if (!db.isError && !summary.isError) return null;
  return (
    <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Couldn't load the salary data" mb="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Text size="sm">The dataset failed to load — check your connection, then reload to try again.</Text>
        <Button size="xs" variant="white" color="red" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </Group>
    </Alert>
  );
}

/** Quiet banner shown while the browser is offline — the PWA's cached shell/data still work, so this
 *  is reassurance rather than an error. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <Alert color="gray" variant="light" icon={<IconWifiOff size={16} />} mb="md">
      <Text size="sm">Offline — showing cached data. Some pages or snapshots may be unavailable until you're back online.</Text>
    </Alert>
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

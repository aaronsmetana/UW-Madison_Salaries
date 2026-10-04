import { useEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from '@mantine/core';
import { IconCheck, IconLink } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * Copy the address of the view on screen: every page a reader builds a view on — its filters, its title,
 * its case — keeps that view in its address, so the link reopens it. Read when pressed, not when drawn: the
 * address changes as the view does, without this button drawing again.
 */
export function CopyLinkButton({ size }: { size?: ButtonProps['size'] }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Button
      size={size}
      variant="default"
      color={copied ? 'pos' : undefined}
      className="copy-link"
      leftSection={copied ? <IconCheck size={ICON.compact} /> : <IconLink size={ICON.compact} />}
      onClick={async () => {
        try { await navigator.clipboard.writeText(window.location.href); } catch { return; }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

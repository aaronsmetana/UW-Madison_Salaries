import { useEffect, useRef, useState } from 'react';
import { Button, Popover, Text, TextInput, type ButtonProps } from '@mantine/core';
import { IconCheck, IconLink } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * Copy the address of the view on screen: every page a reader builds a view on — its filters, its title,
 * its case — keeps that view in its address, so the link reopens it. Read when pressed, not when drawn: the
 * address changes as the view does, without this button drawing again.
 *
 * Where the browser will not let it copy (a refused permission, a page not served securely), it says so and
 * hands the reader the address selected, to copy themselves (I7): it used to do nothing at all.
 */
export function CopyLinkButton({ size }: { size?: ButtonProps['size'] }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Popover opened={manual != null} onChange={(o) => { if (!o) setManual(null); }} position="bottom-end" withArrow shadow="md" width={340} trapFocus returnFocus>
      <Popover.Target>
        <Button
          size={size}
          variant="default"
          color={copied ? 'pos' : undefined}
          className="copy-link"
          leftSection={copied ? <IconCheck size={ICON.compact} /> : <IconLink size={ICON.compact} />}
          onClick={async () => {
            const href = window.location.href;
            try {
              if (!navigator.clipboard) throw new Error('no clipboard');
              await navigator.clipboard.writeText(href);
            } catch {
              setManual(href);
              return;
            }
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className="copy-link-manual">
        <Text size="sm" fw={600} mb={6}>Couldn’t copy — select and copy</Text>
        <TextInput
          size="xs"
          readOnly
          aria-label="The link to this view"
          value={manual ?? ''}
          data-autofocus
          onFocus={(e) => e.currentTarget.select()}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

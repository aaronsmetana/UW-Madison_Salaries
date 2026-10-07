import { Button } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * A table's CSV, beside the table it is the data of: the same button everywhere (the compact control height,
 * the download icon, "CSV"), never a page-level download standing for one of several tables.
 */
export function CsvButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <Button size="xs" variant="default" className="csv-button no-print" leftSection={<IconDownload size={ICON.compact} />}
      onClick={onClick} disabled={disabled} aria-label={label}>
      CSV
    </Button>
  );
}

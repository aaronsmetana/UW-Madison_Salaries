import { useParams } from 'react-router-dom';
import { Stack, Title, Text, Badge, Loader, Alert } from '@mantine/core';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { paidHeadcount } from '../lib/queries';
import { TitleStats } from '../components/TitleStats';

export default function TitlePage() {
  const { code } = useParams();
  const jobCode = decodeURIComponent(code ?? '');
  const snap = useActiveSnapshotId();
  const { metric } = useControls();
  const enabled = !!snap && !!jobCode;

  const { data: hdr, isLoading } = useSql<{ title: string | null; n: number }>(
    ['title-hdr', jobCode, snap ?? '', metric],
    `SELECT arg_max(title, salary) title, ${paidHeadcount(metric)} n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode)}`,
    enabled
  );
  const h = hdr?.[0];

  if (isLoading) return <Loader />;
  if (h && h.n === 0) return <Alert color="gray">No one with job code {jobCode} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{h?.title ?? jobCode}</Title>
        <Text c="dimmed">Job code <Badge variant="light">{jobCode}</Badge> · market view across UW (current snapshot)</Text>
      </div>
      {snap && <TitleStats jobCode={jobCode} snap={snap} metric={metric} />}
    </Stack>
  );
}

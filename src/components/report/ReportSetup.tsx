import { type ReactNode } from 'react';
import {
  Stack, Card, Text, Select, Group, Badge, Button, TextInput, NumberInput, Switch, Radio,
  SegmentedControl, Checkbox, Progress, ActionIcon, Tooltip, Box,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconX, IconPlus, IconCopy, IconCheck, IconRefresh } from '@tabler/icons-react';
import { SearchBox } from '../SearchBox';
import { usd } from '../../lib/format';
import { dropdownProps } from '../../lib/selectProps';
import {
  COHORT_DEFS, FACTOR_DEFS, SECTION_DEFS, type ReportConfig, type CohortMode, type FactorKey,
  type CaseStrength,
} from './model';

export interface SetupComparator { key: string; name: string; title: string | null; school: string | null; tenure: number | null; pay: number | null; isSubject: boolean }
export interface SuggestPerson { key: string; name: string; pay: number }

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>{children}</Text>
);

export function ReportSetup({
  config, onChange, comparators, subjectKey, onSubject, basePay, suggestions, onAddPerson, onRemovePerson,
  cohortBadges, cohortAvailable, targetOptions, caseStrength, talkingPoints, onReset, onHover,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  comparators: SetupComparator[];
  subjectKey: string | null;
  onSubject: (key: string | null) => void;
  basePay: number | null;
  suggestions: SuggestPerson[];
  onAddPerson: (p: { key: string; name: string }) => void;
  onRemovePerson: (key: string) => void;
  cohortBadges: Record<CohortMode, { text: string; deficit: boolean } | null>;
  cohortAvailable: Record<CohortMode, boolean>;
  targetOptions: { value: string; label: string }[];
  caseStrength: CaseStrength | null;
  talkingPoints: string;
  onReset: () => void;
  onHover: (id: string | null) => void;
}) {
  const set = (patch: Partial<ReportConfig>) => onChange({ ...config, ...patch });
  const setFactor = (key: FactorKey, patch: Partial<ReportConfig['factors'][FactorKey]>) =>
    set({ factors: { ...config.factors, [key]: { ...config.factors[key], ...patch } } });
  const clip = useClipboard({ timeout: 1500 });

  const pill = (amt: number) => Math.round(amt);

  return (
    <Stack gap="lg">
      {/* Subject */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>This is me (subject)</SectionLabel>
        <Select
          {...dropdownProps('md')}
          mt={6}
          placeholder="Pick the person the case is for"
          data={comparators.map((c) => ({ value: c.key, label: c.name }))}
          value={subjectKey}
          onChange={onSubject}
          allowDeselect={false}
        />
      </Card>

      {/* Comparators */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Who you're compared against</SectionLabel>
        <Stack gap={6} mt={8}>
          {comparators.map((c) => (
            <Group
              key={c.key}
              justify="space-between"
              wrap="nowrap"
              px={8}
              py={6}
              onMouseEnter={() => onHover(`peer:${c.key}`)}
              onMouseLeave={() => onHover(null)}
              style={{ borderRadius: 8, border: '1px solid var(--mantine-color-default-border)' }}
            >
              <Box style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={600} truncate>{c.name}</Text>
                  {c.isSubject && <Badge size="xs" variant="light" color="indigo" tt="none">You</Badge>}
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {[c.title, c.school, c.tenure != null ? `${c.tenure.toFixed(1)} yr` : null, c.pay != null ? usd(c.pay) : null].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              {!c.isSubject && (
                <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${c.name}`} onClick={() => onRemovePerson(c.key)}>
                  <IconX size={16} />
                </ActionIcon>
              )}
            </Group>
          ))}
        </Stack>

        <Box mt="sm">
          <SearchBox placeholder="Add a comparator by name…" onPick={(h) => onAddPerson({ key: h.person_key, name: h.name })} />
        </Box>

        {suggestions.length > 0 && (
          <Box mt="sm">
            <Text size="xs" c="dimmed" mb={4}>Suggested equity benchmarks (top earners in this title):</Text>
            <Group gap={6}>
              {suggestions.map((s) => (
                <Button key={s.key} size="compact-xs" variant="light" color="indigo" leftSection={<IconPlus size={12} />} onClick={() => onAddPerson({ key: s.key, name: s.name })}>
                  {s.name} ({usd(s.pay)})
                </Button>
              ))}
            </Group>
          </Box>
        )}
      </Card>

      {/* Benchmark cohort */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Benchmark cohort</SectionLabel>
        <Radio.Group value={config.cohort} onChange={(v) => set({ cohort: v as CohortMode })} mt={8}>
          <Stack gap={8}>
            {COHORT_DEFS.filter((c) => cohortAvailable[c.value]).map((c) => {
              const badge = cohortBadges[c.value];
              return (
                <div key={c.value}>
                  <Group gap="xs" wrap="nowrap" justify="space-between">
                    <Radio value={c.value} label={c.label} />
                    {badge && (
                      <Badge size="sm" variant={badge.deficit ? 'filled' : 'light'} color={badge.deficit ? 'indigo' : 'gray'} tt="none">
                        {badge.text}
                      </Badge>
                    )}
                  </Group>
                  {config.cohort === c.value && <Text size="xs" c="dimmed" mt={2} ml={28}>{c.help}</Text>}
                  {c.value === 'tenure' && config.cohort === 'tenure' && (
                    <NumberInput
                      size="xs"
                      mt={6}
                      ml={28}
                      w={160}
                      label="± years of tenure"
                      value={config.tenureBand}
                      onChange={(v) => set({ tenureBand: typeof v === 'number' ? v : 3 })}
                      min={1}
                      max={20}
                    />
                  )}
                </div>
              );
            })}
          </Stack>
        </Radio.Group>
      </Card>

      {/* Target */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Target salary (optional)</SectionLabel>
        <Select
          {...dropdownProps('md')}
          mt={6}
          placeholder="Leave empty → tenure-adjusted median"
          data={targetOptions}
          value={config.targetKey}
          onChange={(v) => set({ targetKey: v })}
          clearable
        />
        <Text size="xs" c="dimmed" mt={4}>Naming a peer sets the base parity to their pay; value-adds stack on top.</Text>
      </Card>

      {/* Justification factors */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Justification factors</SectionLabel>
        <Stack gap="sm" mt={8}>
          {FACTOR_DEFS.map((f) => {
            const st = config.factors[f.key];
            return (
              <Box key={f.key} onMouseEnter={() => onHover(`factor:${f.key}`)} onMouseLeave={() => onHover(null)}>
                <Switch
                  label={f.label}
                  checked={st.on}
                  onChange={(e) => setFactor(f.key, { on: e.currentTarget.checked })}
                />
                {st.on && (
                  <Stack gap={6} mt={6} ml={34}>
                    <TextInput
                      size="xs"
                      placeholder={f.placeholder}
                      value={st.note}
                      onChange={(e) => setFactor(f.key, { note: e.currentTarget.value })}
                    />
                    <Group gap={6} wrap="wrap" align="center">
                      <NumberInput
                        size="xs"
                        w={130}
                        placeholder="+$ (optional)"
                        prefix="$"
                        thousandSeparator=","
                        value={st.amount}
                        onChange={(v) => setFactor(f.key, { amount: typeof v === 'number' ? v : '' })}
                        min={0}
                      />
                      {basePay != null && (
                        <>
                          <Button size="compact-xs" variant="default" onClick={() => setFactor(f.key, { amount: pill(basePay * 0.01) })}>
                            +1% ({usd(pill(basePay * 0.01))})
                          </Button>
                          <Button size="compact-xs" variant="default" onClick={() => setFactor(f.key, { amount: pill(basePay * 0.025) })}>
                            +2.5% ({usd(pill(basePay * 0.025))})
                          </Button>
                        </>
                      )}
                    </Group>
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
      </Card>

      {/* Outcome override */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Override the outcome</SectionLabel>
        <NumberInput
          mt={6}
          label="Final recommended salary"
          description="Leave empty to use base + value-adds"
          placeholder="Auto"
          prefix="$"
          thousandSeparator=","
          value={config.override}
          onChange={(v) => set({ override: typeof v === 'number' ? v : '' })}
          min={0}
        />
        <TextInput
          mt="sm"
          label="Headline (optional)"
          placeholder="Override the recommendation sentence"
          value={config.headline}
          onChange={(e) => set({ headline: e.currentTarget.value })}
        />
      </Card>

      {/* Strategy tools — Kitchen-only (never on the right pane) */}
      <Card withBorder radius="md" padding="md" bg="var(--mantine-color-default-hover)">
        <SectionLabel>Strategy tools (private)</SectionLabel>

        {caseStrength && (
          <Box mt={8}>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={600}>Case strength</Text>
              <Badge variant="light" color={caseStrength.label === 'Strong' ? 'green' : caseStrength.label === 'Moderate' ? 'indigo' : 'gray'}>
                {caseStrength.label} · {caseStrength.score}
              </Badge>
            </Group>
            <Stack gap={4}>
              {caseStrength.parts.map((p) => (
                <div key={p.label}>
                  <Text size="xs" c="dimmed">{p.label}</Text>
                  <Progress value={p.value} color="indigo" size="sm" radius="sm" />
                </div>
              ))}
            </Stack>
          </Box>
        )}

        <Box mt="md">
          <Text size="sm" fw={600} mb={4}>Document format</Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={config.format}
            onChange={(v) => set({ format: v as ReportConfig['format'] })}
            data={[{ value: 'brief', label: 'Manager/HR brief' }, { value: 'detailed', label: 'Detailed review' }]}
          />
        </Box>

        <Button
          mt="md"
          variant="light"
          color={clip.copied ? 'teal' : 'indigo'}
          leftSection={clip.copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          onClick={() => clip.copy(talkingPoints)}
          fullWidth
        >
          {clip.copied ? 'Copied talking points' : 'Copy talking points'}
        </Button>
      </Card>

      {/* Sections + reset */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Report sections</SectionLabel>
        <Checkbox.Group value={config.sections} onChange={(v) => set({ sections: v })} mt={8}>
          <Stack gap="xs">
            {SECTION_DEFS.map((s) => <Checkbox key={s.value} value={s.value} label={s.label} />)}
          </Stack>
        </Checkbox.Group>
        <Group justify="flex-end" mt="md">
          <Tooltip label="Clear all factors, target, override and cohort back to defaults">
            <Button variant="subtle" color="gray" size="xs" leftSection={<IconRefresh size={14} />} onClick={onReset}>
              Reset setup
            </Button>
          </Tooltip>
        </Group>
      </Card>
    </Stack>
  );
}

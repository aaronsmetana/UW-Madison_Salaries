import { type ReactNode } from 'react';
import {
  Stack, Card, Text, Select, Group, Badge, Button, TextInput, NumberInput, Switch, Radio,
  SegmentedControl, Checkbox, Progress, ActionIcon, Tooltip, Box,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconX, IconPlus, IconCopy, IconCheck, IconRefresh, IconTarget, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { SearchBox } from '../SearchBox';
import { usd, pct } from '../../lib/format';
import { dropdownProps } from '../../lib/selectProps';
import {
  COHORT_DEFS, FACTOR_DEFS, SECTION_DEFS, newCustomFactor, type ReportConfig, type CohortMode, type FactorKey,
  type CaseStrength, type BadgeTone, type StrengthKey, type SupervisoryCase,
} from './model';

export interface SetupComparator { key: string; name: string; title: string | null; school: string | null; tenure: number | null; pay: number | null; isSubject: boolean }
export interface SuggestPerson { key: string; name: string; pay: number }

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>{children}</Text>
);

export function ReportSetup({
  config, onChange, comparators, subjectKey, onSubject, basePay, suggestions, inversionSuggestions, onAddPerson, onRemovePerson,
  cohortBadges, cohortAvailable, targetOptions, caseStrength, strengthHints, talkingPoints, overAsk, overAskAnchor, cohortP75, recommended, onReset, onHover,
  supervisoryCase, onAddSupervisee, onRemoveSupervisee, evidenceChecklist, marketFloor, performanceGuide,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  comparators: SetupComparator[];
  subjectKey: string | null;
  onSubject: (key: string | null) => void;
  basePay: number | null;
  suggestions: SuggestPerson[];
  inversionSuggestions: SuggestPerson[];
  onAddPerson: (p: { key: string; name: string }) => void;
  onRemovePerson: (key: string) => void;
  cohortBadges: Record<CohortMode, { text: string; tone: BadgeTone } | null>;
  cohortAvailable: Record<CohortMode, boolean>;
  targetOptions: { value: string; label: string }[];
  caseStrength: CaseStrength | null;
  strengthHints: Partial<Record<StrengthKey, { text: string; tone: 'action' | 'fixed' }>>;
  talkingPoints: string;
  overAsk: boolean;
  /** When the ask exceeds cohort p75, which guideline anchor (if any) justifies it — drives the notice's
   *  tone: an anchored over-ask is informational, an unanchored one is a credibility warning. */
  overAskAnchor: 'supervisor' | 'marketFloor' | null;
  cohortP75: number | null;
  /** The current recommended salary — powers the sticky footer that tracks factor toggles. */
  recommended: number | null;
  onReset: () => void;
  onHover: (id: string | null) => void;
  /** Resolved direct reports named under the Supervisory-scope factor (pay/differential vs. the
   *  subject) — a distinct, report-local list, never mixed into the peer/comparator tray. */
  supervisoryCase: SupervisoryCase;
  onAddSupervisee: (p: { key: string; name: string }) => void;
  onRemoveSupervisee: (key: string) => void;
  /** Which evidence sections will actually render in the document (and why not, when they won't) —
   *  a private nudge so the user can see how to strengthen the case before printing. `sectionId` links
   *  a row to its document section so clicking it scrolls the brief there. */
  evidenceChecklist: { label: string; ok: boolean; note?: string; sectionId?: string }[];
  /** The SAG market-competitive floor (85% of the grade midpoint) when the subject is below it — powers
   *  the opt-in floor target next to the target Select. Null when no published band / already competitive. */
  marketFloor: { floorPay: number; compa: number; grade: number } | null;
  /** SAG performance-adjustment coaching for the Performance factor (5–10% general range + the annual-
   *  review matrix cell for the subject's position in grade, with midrange dollar suggestions). */
  performanceGuide: {
    position: string | null;
    general: readonly [number, number];
    exemplary: readonly [number, number]; meets: readonly [number, number];
    exemplaryAmt: number; meetsAmt: number;
  } | null;
}) {
  const set = (patch: Partial<ReportConfig>) => onChange({ ...config, ...patch });
  const setFactor = (key: FactorKey, patch: Partial<ReportConfig['factors'][FactorKey]>) =>
    set({ factors: { ...config.factors, [key]: { ...config.factors[key], ...patch } } });
  const clip = useClipboard({ timeout: 1500 });
  const peers = comparators.filter((c) => !c.isSubject);

  const pill = (amt: number) => Math.round(amt);
  // Semantic scenting: the strongest (biggest-deficit) lens is the magnet; a surplus is a warning.
  const badgeStyle = (tone: BadgeTone): { variant: string; color: string } => {
    switch (tone) {
      case 'best': return { variant: 'filled', color: 'accent' };
      case 'deficit': return { variant: 'light', color: 'accent' };
      case 'surplus': return { variant: 'light', color: 'orange' };
      default: return { variant: 'light', color: 'gray' };
    }
  };

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

      {/* Comparators — the subject is the anchor above; this tray holds only the other side of the scale. */}
      <Card withBorder radius="md" padding="md">
        <SectionLabel>Who you're compared against</SectionLabel>
        <Box mt={8} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, overflow: 'hidden' }}>
          {peers.length === 0 && (
            <Text size="sm" c="dimmed" px="sm" py={8}>No comparators yet — search below, or add a suggestion.</Text>
          )}
          {peers.map((c) => (
            <Group
              key={c.key}
              justify="space-between"
              wrap="nowrap"
              px={10}
              py={8}
              onMouseEnter={() => onHover(`peer:${c.key}`)}
              onMouseLeave={() => onHover(null)}
              style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
            >
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>{c.name}</Text>
                <Text size="xs" c="dimmed" truncate>
                  {[c.title, c.school, c.tenure != null ? `${c.tenure.toFixed(1)} yr` : null, c.pay != null ? usd(c.pay) : null].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              <Group gap={4} wrap="nowrap">
                <Tooltip label={config.targetKey === c.key ? 'Parity target — click to clear' : 'Set as parity target'} withArrow>
                  <ActionIcon
                    variant={config.targetKey === c.key ? 'filled' : 'subtle'}
                    color={config.targetKey === c.key ? 'accent' : 'gray'}
                    aria-label={config.targetKey === c.key ? `Clear ${c.name} as parity target` : `Set ${c.name} as parity target`}
                    onClick={() => set({ targetKey: config.targetKey === c.key ? null : c.key })}
                  >
                    <IconTarget size={16} />
                  </ActionIcon>
                </Tooltip>
                <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${c.name}`} onClick={() => onRemovePerson(c.key)}>
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            </Group>
          ))}
          {/* Docked input — typing here injects a comparator into the list above. */}
          <Box px={8} py={6}>
            <SearchBox placeholder="Add a comparator by name…" onPick={(h) => onAddPerson({ key: h.person_key, name: h.name })} />
          </Box>
        </Box>

        {suggestions.length > 0 && (
          <Box mt="sm">
            <Text size="xs" c="dimmed" mb={4}>Suggested equity benchmarks (top earners in this title):</Text>
            <Group gap={6}>
              {suggestions.map((s) => (
                <Button key={s.key} size="compact-xs" variant="light" color="accent" leftSection={<IconPlus size={12} />} onClick={() => onAddPerson({ key: s.key, name: s.name })}>
                  {s.name} ({usd(s.pay)})
                </Button>
              ))}
            </Group>
          </Box>
        )}

        {inversionSuggestions.length > 0 && (
          <Box mt="sm">
            <Text size="xs" c="dimmed" mb={4}>Strong comparators — less UW tenure, paid more:</Text>
            <Group gap={6}>
              {inversionSuggestions.map((s) => (
                <Button key={s.key} size="compact-xs" variant="light" color="orange" leftSection={<IconPlus size={12} />} onClick={() => onAddPerson({ key: s.key, name: s.name })}>
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
                      <Badge size="sm" {...badgeStyle(badge.tone)} tt="none" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
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
        {marketFloor && (
          <Checkbox
            mt={10}
            size="xs"
            label={`Set target to the market-competitive floor — 85% of grade ${marketFloor.grade}'s midpoint (${usd(marketFloor.floorPay)}) · UW salary guideline`}
            checked={config.marketFloorTarget}
            onChange={(e) => set({ marketFloorTarget: e.currentTarget.checked })}
          />
        )}
        {marketFloor && (
          <Text size="xs" c="dimmed" mt={4}>
            Current pay is a {marketFloor.compa.toFixed(2)} compa-ratio — below the guideline's 0.85 market-competitive floor. The highest opted-in guideline anchor wins; it never lowers the ask.
          </Text>
        )}
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
                    {!st.note.trim() && (
                      <Text size="xs" c="orange.7">Add a specific example — factors without evidence read as filler.</Text>
                    )}
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

                    {/* Supervisory pay-inversion check — report-local, distinct from the peer/comparator tray */}
                    {f.key === 'supervision' && (
                      <Box mt={8} pt={8} style={{ borderTop: '1px dashed var(--mantine-color-default-border)' }}>
                        <Text size="xs" fw={600} c="dimmed" mb={4}>Direct reports (optional — checks for a supervisory pay inversion)</Text>
                        <SearchBox
                          size="sm"
                          placeholder="Name a direct report you supervise…"
                          onPick={(h) => onAddSupervisee({ key: h.person_key, name: h.name })}
                        />
                        {supervisoryCase.reports.length > 0 && (
                          <Stack gap={4} mt={8}>
                            {supervisoryCase.reports.map((r) => (
                              <Group key={r.key} justify="space-between" wrap="nowrap" gap={6}>
                                <Text size="xs" truncate style={{ flex: 1, minWidth: 0 }}>{r.name} · {usd(r.pay)}</Text>
                                <Group gap={4} wrap="nowrap">
                                  <Badge
                                    size="xs" variant="light" tt="none" style={{ whiteSpace: 'nowrap' }}
                                    color={r.inverted ? 'orange' : r.belowFloor ? 'yellow' : 'gray'}
                                  >
                                    {r.inverted ? '+' : '−'}{pct(r.differential)} — {r.inverted ? 'inversion' : r.belowFloor ? 'under the 15% guideline' : 'meets guideline'}
                                  </Badge>
                                  <ActionIcon variant="subtle" color="gray" size="xs" aria-label={`Remove ${r.name}`} onClick={() => onRemoveSupervisee(r.key)}>
                                    <IconX size={12} />
                                  </ActionIcon>
                                </Group>
                              </Group>
                            ))}
                          </Stack>
                        )}
                        {supervisoryCase.top && supervisoryCase.target15 != null
                          && supervisoryCase.reports.some((r) => r.belowFloor)
                          && (basePay == null || supervisoryCase.target15 > basePay) && (
                          <Checkbox
                            mt={8}
                            size="xs"
                            label={`Set target to 15% above ${supervisoryCase.top.name} (${usd(supervisoryCase.target15)}) — UW Salary Administration Guidelines`}
                            checked={config.supervisorTarget}
                            onChange={(e) => set({ supervisorTarget: e.currentTarget.checked })}
                          />
                        )}
                      </Box>
                    )}

                    {/* Performance-adjustment coaching — the SAG's 5–10% range + the matrix cell for the
                        subject's position in grade, with one-click dollar suggestions. */}
                    {f.key === 'performance' && performanceGuide && (
                      <Box mt={4}>
                        <Text size="xs" c="dimmed">
                          UW guideline: a performance adjustment of {pct(performanceGuide.general[0])}–{pct(performanceGuide.general[1])} may be appropriate
                          {performanceGuide.position ? ` (${performanceGuide.position}: Exemplary ${pct(performanceGuide.exemplary[0])}–${pct(performanceGuide.exemplary[1])}, Meets ${pct(performanceGuide.meets[0])}–${pct(performanceGuide.meets[1])})` : ''}.
                        </Text>
                        {basePay != null && (
                          <Group gap={6} wrap="wrap" mt={4}>
                            <Button size="compact-xs" variant="default" onClick={() => setFactor('performance', { amount: performanceGuide.exemplaryAmt })}>
                              Exemplary ≈ {usd(performanceGuide.exemplaryAmt)}
                            </Button>
                            <Button size="compact-xs" variant="default" onClick={() => setFactor('performance', { amount: performanceGuide.meetsAmt })}>
                              Meets ≈ {usd(performanceGuide.meetsAmt)}
                            </Button>
                          </Group>
                        )}
                      </Box>
                    )}

                    {/* Change-in-duties coaching — the SAG warns volume alone doesn't warrant an adjustment. */}
                    {f.key === 'scope' && (
                      <Text size="xs" c="dimmed" mt={4}>
                        UW guideline: a “change in duties pay adjustment” rests on significant, permanent changes to complexity, scope, or accountability — a higher volume of the same work does not, on its own, warrant an adjustment.
                      </Text>
                    )}
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>

        {/* Custom (user-typed) factors — same shape as the built-ins, but open-ended. */}
        {config.customFactors.length > 0 && (
          <Stack gap="sm" mt="md">
            {config.customFactors.map((c) => (
              <Box key={c.id}>
                <Group gap={6} wrap="nowrap" align="center">
                  <TextInput
                    size="xs"
                    style={{ flex: 1 }}
                    placeholder="Custom factor (e.g. bilingual — client-facing role)"
                    value={c.label}
                    onChange={(e) =>
                      set({ customFactors: config.customFactors.map((x) => (x.id === c.id ? { ...x, label: e.currentTarget.value } : x)) })
                    }
                  />
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="Remove custom factor"
                    onClick={() => set({ customFactors: config.customFactors.filter((x) => x.id !== c.id) })}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
                <Group gap={6} wrap="wrap" align="center" mt={6} ml={0}>
                  <NumberInput
                    size="xs"
                    w={130}
                    placeholder="+$ (optional)"
                    prefix="$"
                    thousandSeparator=","
                    value={c.amount}
                    onChange={(v) =>
                      set({ customFactors: config.customFactors.map((x) => (x.id === c.id ? { ...x, amount: typeof v === 'number' ? v : '' } : x)) })
                    }
                    min={0}
                  />
                  {basePay != null && (
                    <>
                      <Button
                        size="compact-xs"
                        variant="default"
                        onClick={() => set({ customFactors: config.customFactors.map((x) => (x.id === c.id ? { ...x, amount: pill(basePay * 0.01) } : x)) })}
                      >
                        +1% ({usd(pill(basePay * 0.01))})
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="default"
                        onClick={() => set({ customFactors: config.customFactors.map((x) => (x.id === c.id ? { ...x, amount: pill(basePay * 0.025) } : x)) })}
                      >
                        +2.5% ({usd(pill(basePay * 0.025))})
                      </Button>
                    </>
                  )}
                </Group>
              </Box>
            ))}
          </Stack>
        )}
        <Button
          size="xs"
          variant="subtle"
          mt="sm"
          leftSection={<IconPlus size={14} />}
          onClick={() => set({ customFactors: [...config.customFactors, newCustomFactor()] })}
        >
          Add custom factor
        </Button>
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
        <Group justify="space-between" align="center" wrap="nowrap">
          <SectionLabel>Strategy tools (private)</SectionLabel>
          <Button
            variant="subtle"
            size="compact-xs"
            color={clip.copied ? 'pos' : 'gray'}
            leftSection={clip.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            onClick={() => clip.copy(talkingPoints)}
          >
            {clip.copied ? 'Copied' : 'Export talking points'}
          </Button>
        </Group>

        {caseStrength && (
          <Box mt={8}>
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={600}>Case strength</Text>
              <Badge variant="light" color={caseStrength.label === 'Strong' ? 'green' : caseStrength.label === 'Moderate' ? 'accent' : 'gray'}>
                {caseStrength.label} · {caseStrength.score}
              </Badge>
            </Group>
            <Stack gap={8}>
              {caseStrength.parts.map((p) => {
                const maxed = p.value >= p.max;
                const hint = strengthHints[p.key];
                return (
                  <div key={p.key}>
                    <Group justify="space-between" gap={4} mb={2}>
                      <Text size="xs" c="dimmed">{p.label}</Text>
                      <Group gap={3} wrap="nowrap">
                        {maxed && <IconCheck size={12} color="var(--mantine-color-pos-6)" />}
                        <Text size="xs" c="dimmed" fw={600}>{p.value}<Text span c="dimmed" fw={400}> / {p.max}</Text></Text>
                      </Group>
                    </Group>
                    <Progress value={p.value} color={p.value > 0 ? 'accent' : 'gray'} size="sm" radius="sm" />
                    {!maxed && hint && (
                      <Text size="xs" mt={3} c={hint.tone === 'action' ? 'accent.7' : 'dimmed'}>
                        {hint.tone === 'action' ? '↳ ' : ''}{hint.text}
                      </Text>
                    )}
                  </div>
                );
              })}
            </Stack>
            <Text size="xs" c="dimmed" mt={8}>Bars show each signal's contribution to the {caseStrength.score}-point score.</Text>
          </Box>
        )}

        {evidenceChecklist.length > 0 && (
          <Box mt="md">
            <Text size="sm" fw={600} mb={4}>Evidence in this report</Text>
            <Text size="xs" c="dimmed" mb={6}>Click a rendered item to jump to it in the document.</Text>
            <Stack gap={3}>
              {evidenceChecklist.map((e) => {
                const jump = e.ok && e.sectionId
                  ? () => document.getElementById(`report-sec-${e.sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  : undefined;
                return (
                  <Group
                    key={e.label} gap={6} wrap="nowrap" align="flex-start"
                    onClick={jump}
                    style={jump ? { cursor: 'pointer' } : undefined}
                  >
                    {e.ok
                      ? <IconCheck size={13} color="var(--mantine-color-pos-6)" style={{ flexShrink: 0, marginTop: 2 }} />
                      : <IconX size={13} color="var(--mantine-color-gray-5)" style={{ flexShrink: 0, marginTop: 2 }} />}
                    <Text size="xs" c={e.ok ? undefined : 'dimmed'} td={jump ? 'underline' : undefined} style={jump ? { textDecorationStyle: 'dotted', textUnderlineOffset: 2 } : undefined}>
                      {e.label}{e.note ? <Text span c="dimmed" td="none"> — {e.note}</Text> : null}
                    </Text>
                  </Group>
                );
              })}
            </Stack>
          </Box>
        )}

        {overAsk && (
          <Group gap={6} wrap="nowrap" align="flex-start" mt="md">
            {overAskAnchor ? (
              <>
                <IconInfoCircle size={14} color="var(--mantine-color-accent-6)" style={{ flexShrink: 0, marginTop: 2 }} />
                <Text size="xs" c="accent.7">
                  The ask exceeds this cohort's 75th percentile{cohortP75 != null ? ` (${usd(cohortP75)})` : ''}, but it's anchored to the
                  UW guideline's {overAskAnchor === 'supervisor' ? '15% supervisory differential above a named direct report' : 'market-competitive floor (85% of the grade midpoint)'} — cite the guideline when you present it, not an unsupported reach.
                </Text>
              </>
            ) : (
              <>
                <IconAlertTriangle size={14} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0, marginTop: 2 }} />
                <Text size="xs" c="orange.7">
                  The ask exceeds this cohort's 75th percentile{cohortP75 != null ? ` (${usd(cohortP75)})` : ''} — consider trimming value-adds for credibility.
                </Text>
              </>
            )}
          </Group>
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

        <Switch
          mt="md"
          label="Anonymize peer names in document"
          description="Renders comparators as “Peer A/B/C…” in the printed brief; this setup pane always shows real names."
          checked={config.anonymize}
          onChange={(e) => set({ anonymize: e.currentTarget.checked })}
        />
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

      {/* Sticky recommendation readout — the long setup pane means a factor toggle near the top moves the
          number well off-screen; this pins the current figure so every edit shows its effect at a glance. */}
      {recommended != null && basePay != null && (
        <Box
          style={{
            position: 'sticky', bottom: 0, zIndex: 2,
            marginInline: 'calc(-1 * var(--mantine-spacing-md))', marginBottom: 'calc(-1 * var(--mantine-spacing-md))',
            padding: '10px var(--mantine-spacing-md)',
            background: 'var(--mantine-color-body)',
            borderTop: '1px solid var(--mantine-color-default-border)',
          }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.05em' }}>Recommended</Text>
            <Text size="sm" fw={800} c="pos.7">
              {usd(recommended)}
              {recommended > basePay && <Text span c="dimmed" fw={600}> (+{pct((recommended - basePay) / basePay)})</Text>}
            </Text>
          </Group>
        </Box>
      )}
    </Stack>
  );
}

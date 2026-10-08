import { type ReactNode } from 'react';
import {
  Stack, Card, Text, Select, Group, Badge, Button, TextInput, NumberInput, Switch, Radio,
  SegmentedControl, Checkbox, Progress, ActionIcon, Tooltip, Box, Menu,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconX, IconPlus, IconCopy, IconCheck, IconRefresh, IconAlertTriangle, IconInfoCircle, IconChevronRight } from '@tabler/icons-react';
import { SearchBox } from '../SearchBox';
import { Eyebrow } from '../Eyebrow';
import { CardTitle } from '../CardTitle';
import { usd, pct, fmtYears, fmtChange } from '../../lib/format';
import { dropdownProps } from '../../lib/selectProps';
import { ICON } from '../../lib/ui';
import { Z } from '../../lib/layers';
import {
  FACTOR_DEFS, SECTION_DEFS, newCustomFactor, applyAsk, type ReportConfig, type FactorKey,
  type CaseStrength, type StrengthKey, type SupervisoryCase, type AskOption, type AskValue,
} from './model';

export interface SetupComparator { key: string; name: string; title: string | null; school: string | null; tenure: number | null; pay: number | null; isSubject: boolean }
export interface SuggestPerson { key: string; name: string; pay: number }

const SectionLabel = ({ children }: { children: ReactNode }) => <Eyebrow>{children}</Eyebrow>;

export function ReportSetup({
  config, onChange, comparators, subjectKey, onSubject, basePay, suggestions, inversionSuggestions, onAddPerson, onRemovePerson,
  asks, askValue, caseStrength, strengthHints, talkingPoints, overAsk, overAskAnchor, cohortP75, recommended, readout, onReset, onHover,
  supervisoryCase, onAddSupervisee, onRemoveSupervisee, evidenceChecklist, performanceGuide,
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
  /** What the case may ask for, each with its figure, and which it asks for (`askOptions`, `askValueOf`). */
  asks: AskOption[];
  askValue: AskValue;
  caseStrength: CaseStrength | null;
  strengthHints: Partial<Record<StrengthKey, { text: string; tone: 'action' | 'fixed' }>>;
  talkingPoints: string;
  overAsk: boolean;
  /** When the ask exceeds cohort p75, which guideline anchor (if any) justifies it — drives the notice's
   *  tone: an anchored over-ask is informational, an unanchored one is a credibility warning. */
  overAskAnchor: 'supervisor' | 'marketFloor' | null;
  cohortP75: number | null;
  /** The current recommended salary: the sticky readout that tracks factor toggles, and where a figure of one's
   *  own starts. */
  recommended: number | null;
  /** Whether the setup shows its own readout of it: not on a phone, where the page's ledger shows it. */
  readout: boolean;
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

  return (
    <Stack gap="lg">
      {/* Subject */}
      <Card withBorder padding="md">
        <SectionLabel>Subject</SectionLabel>
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

      {/* What to ask for: one choice, second, as a case is argued: whose pay, then what to ask, then with whom and
          why it is more (`askOptions` in the model). */}
      <Card withBorder padding="md">
        <SectionLabel>What to ask for</SectionLabel>
        <Radio.Group value={askValue} onChange={(v) => onChange(applyAsk(config, v as AskValue, recommended))} mt={8}>
          <Stack gap={8}>
            {asks.map((o) => (
              <div key={o.value}>
                <Group gap="xs" wrap="nowrap" justify="space-between" align="flex-start">
                  <Radio value={o.value} label={o.label} disabled={o.disabled} />
                  {o.pay != null && (
                    <Box ta="right" style={{ flexShrink: 0 }}>
                      <Text size="sm" fw={600} c={o.disabled ? 'dimmed' : undefined}>{usd(o.pay)}</Text>
                      {basePay != null && basePay > 0 && <Text size="xs" c="dimmed">{fmtChange((o.pay - basePay) / basePay)}</Text>}
                    </Box>
                  )}
                </Group>
                {(askValue === o.value || o.disabled) && o.help && <Text size="xs" c="dimmed" mt={2} ml={28}>{o.help}</Text>}
                {o.value === 'cohort:tenure' && askValue === o.value && (
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
                {o.value === 'own' && askValue === 'own' && (
                  <NumberInput
                    size="xs"
                    mt={6}
                    ml={28}
                    w={180}
                    aria-label="Salary to ask for"
                    prefix="$"
                    thousandSeparator=","
                    value={config.override}
                    onChange={(v) => set({ override: typeof v === 'number' ? v : '' })}
                    min={0}
                  />
                )}
              </div>
            ))}
          </Stack>
        </Radio.Group>
        <Text size="xs" c="dimmed" mt="sm">
          {askValue === 'own'
            ? 'Asked as written: the factors’ amounts are not added to it.'
            : 'The factors’ amounts below are added to it.'}
        </Text>
        <TextInput
          mt="sm"
          label="Headline (optional)"
          placeholder="Override the recommendation sentence"
          value={config.headline}
          onChange={(e) => set({ headline: e.currentTarget.value })}
        />
      </Card>

      {/* Comparators — the subject is the anchor above; this tray holds only the other side of the scale. */}
      <Card withBorder padding="md">
        <SectionLabel>Compared with</SectionLabel>
        <Box mt={8} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 10, overflow: 'hidden' }}>
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
                  {[c.title, c.school, c.tenure != null ? fmtYears(c.tenure) : null, c.pay != null ? usd(c.pay) : null].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${c.name}`} onClick={() => onRemovePerson(c.key)}>
                <IconX size={ICON.control} />
              </ActionIcon>
            </Group>
          ))}
          {/* Docked input — typing here injects a comparator into the list above. */}
          <Box px={8} py={6}>
            <SearchBox kinds={['people']} placeholder="Add a comparator by name…" onPick={(h) => onAddPerson({ key: h.person_key, name: h.name })} />
          </Box>
        </Box>

        {suggestions.length > 0 && (
          <Box mt="sm">
            <Text size="xs" c="dimmed" mb={4}>Suggested benchmarks (top earners in this title):</Text>
            <Group gap={6}>
              {suggestions.map((s) => (
                <Button key={s.key} size="compact-xs" variant="light" color="accent" leftSection={<IconPlus size={ICON.compact} />} onClick={() => onAddPerson({ key: s.key, name: s.name })}>
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
                <Button key={s.key} size="compact-xs" variant="light" color="orange" leftSection={<IconPlus size={ICON.compact} />} onClick={() => onAddPerson({ key: s.key, name: s.name })}>
                  {s.name} ({usd(s.pay)})
                </Button>
              ))}
            </Group>
          </Box>
        )}
      </Card>

      {/* Justification factors */}
      <Card withBorder padding="md">
        <SectionLabel>Justification factors</SectionLabel>
        {/* Only the factors in use are listed, with their note and amount; the rest wait in one menu
            below, the way comparators are added. Eleven switches, nearly all off, made the reader
            scroll past the unused ones to reach the one they had. */}
        <Stack gap="sm" mt={8}>
          {FACTOR_DEFS.filter((f) => config.factors[f.key].on).map((f) => {
            const st = config.factors[f.key];
            return (
              <Box key={f.key} data-factor={f.key} onMouseEnter={() => onHover(`factor:${f.key}`)} onMouseLeave={() => onHover(null)}>
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
                      <Text size="xs" c="orange">Add a specific example — factors without evidence read as filler.</Text>
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
                          kinds={['people']}
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
                                    size="xs" variant="light" style={{ whiteSpace: 'nowrap' }}
                                    color={r.inverted ? 'red' : r.belowFloor ? 'orange' : 'gray'}
                                  >
                                    {r.inverted ? '+' : '−'}{pct(r.differential)} — {r.inverted ? 'inversion' : r.belowFloor ? 'under the 15% guideline' : 'meets guideline'}
                                  </Badge>
                                  <ActionIcon variant="subtle" color="gray" size="xs" aria-label={`Remove ${r.name}`} onClick={() => onRemoveSupervisee(r.key)}>
                                    <IconX size={ICON.compact} />
                                  </ActionIcon>
                                </Group>
                              </Group>
                            ))}
                          </Stack>
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
                    <IconX size={ICON.compact} />
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
        <Menu position="bottom-start" shadow="md" withinPortal>
          <Menu.Target>
            <Button size="xs" variant="subtle" mt="sm" leftSection={<IconPlus size={ICON.compact} />}>
              Add a justification factor
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {FACTOR_DEFS.filter((f) => !config.factors[f.key].on).map((f) => (
              <Menu.Item key={f.key} onClick={() => setFactor(f.key, { on: true })}>{f.label}</Menu.Item>
            ))}
            <Menu.Divider />
            <Menu.Item onClick={() => set({ customFactors: [...config.customFactors, newCustomFactor()] })}>
              Custom factor…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Card>

      {/* Strategy tools — Kitchen-only (never on the right pane) */}
      <Card withBorder padding="md" bg="var(--mantine-color-default-hover)">
        <Group justify="space-between" align="center" wrap="nowrap">
          <SectionLabel>Strategy tools (private)</SectionLabel>
          <Button
            variant="subtle"
            size="compact-xs"
            color={clip.copied ? 'pos' : 'gray'}
            leftSection={clip.copied ? <IconCheck size={ICON.compact} /> : <IconCopy size={ICON.compact} />}
            onClick={() => clip.copy(talkingPoints)}
          >
            {clip.copied ? 'Copied' : 'Export talking points'}
          </Button>
        </Group>

        {caseStrength && (
          <Box mt={8}>
            <CardTitle
              mb={6}
              right={
                <Badge variant="light" color={caseStrength.label === 'Strong' ? 'pos' : caseStrength.label === 'Moderate' ? 'accent' : 'gray'}>
                  {caseStrength.label} · {caseStrength.score}
                </Badge>
              }
            >
              Case strength
            </CardTitle>
            <Stack gap={8}>
              {caseStrength.parts.map((p) => {
                const maxed = p.value >= p.max;
                const hint = strengthHints[p.key];
                return (
                  <div key={p.key}>
                    <Group justify="space-between" gap={4} mb={2}>
                      <Text size="xs" c="dimmed">{p.label}</Text>
                      <Group gap={3} wrap="nowrap">
                        {maxed && <IconCheck size={ICON.compact} color="var(--mantine-color-pos-6)" />}
                        <Text size="xs" c="dimmed" fw={600}>{p.value}<Text span c="dimmed" fw={400}> / {p.max}</Text></Text>
                      </Group>
                    </Group>
                    <Progress value={p.value} color={p.value > 0 ? 'accent' : 'gray'} size="sm" radius="sm" aria-label={`${p.label}: ${p.value} of ${p.max}`} />
                    {!maxed && hint && (
                      <Text size="xs" mt={3} c={hint.tone === 'action' ? 'accent.7' : 'dimmed'} className={hint.tone === 'action' ? 'accent7-text' : undefined}>
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
            <CardTitle mb={6} sub="Click a rendered item to jump to it in the document.">
              Evidence in this report
            </CardTitle>
            <Stack gap={3}>
              {evidenceChecklist.map((e) => {
                const jump = e.ok && e.sectionId
                  ? () => document.getElementById(`report-sec-${e.sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  : undefined;
                return (
                  <Group
                    key={e.label} gap={6} wrap="nowrap" align="flex-start"
                    className={jump ? 'evidence-jump' : undefined}
                    onClick={jump}
                    style={jump ? { cursor: 'pointer' } : undefined}
                    tabIndex={jump ? 0 : undefined}
                    role={jump ? 'button' : undefined}
                    onKeyDown={jump ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); jump(); } } : undefined}
                  >
                    {e.ok
                      ? <IconCheck size={ICON.compact} color="var(--mantine-color-pos-6)" style={{ flexShrink: 0, marginTop: 2 }} />
                      : <IconX size={ICON.compact} color="var(--mantine-color-gray-5)" style={{ flexShrink: 0, marginTop: 2 }} />}
                    <Text size="xs" c={e.ok ? undefined : 'dimmed'} style={{ flex: 1, minWidth: 0 }}>
                      {e.label}{e.note ? <Text span c="dimmed"> — {e.note}</Text> : null}
                    </Text>
                    {jump && <IconChevronRight className="evidence-jump-chevron" size={ICON.compact} style={{ flexShrink: 0, marginTop: 2, opacity: 0, transition: 'opacity var(--dur-fast) var(--ease)' }} />}
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
                <IconInfoCircle size={ICON.compact} color="var(--mantine-color-accent-6)" style={{ flexShrink: 0, marginTop: 2 }} />
                <Text size="xs" c="accent.7" className="accent7-text">
                  The ask exceeds this group's 75th percentile{cohortP75 != null ? ` (${usd(cohortP75)})` : ''}, but it's anchored to the
                  UW guideline's {overAskAnchor === 'supervisor' ? '15% supervisory differential above a named direct report' : 'market-competitive floor (85% of the grade midpoint)'} — cite the guideline when you present it, not an unsupported reach.
                </Text>
              </>
            ) : (
              <>
                <IconAlertTriangle size={ICON.compact} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0, marginTop: 2 }} />
                <Text size="xs" c="orange">
                  The ask exceeds this group's 75th percentile{cohortP75 != null ? ` (${usd(cohortP75)})` : ''} — consider trimming value-adds for credibility.
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
      <Card withBorder padding="md">
        <SectionLabel>Report sections</SectionLabel>
        <Checkbox.Group value={config.sections} onChange={(v) => set({ sections: v })} mt={8}>
          <Stack gap="xs">
            {SECTION_DEFS.map((s) => <Checkbox key={s.value} value={s.value} label={s.label} />)}
          </Stack>
        </Checkbox.Group>
        <Group justify="flex-end" mt="md">
          <Tooltip label="Clear the factors and the ask back to defaults">
            <Button variant="subtle" color="gray" size="xs" leftSection={<IconRefresh size={ICON.compact} />} onClick={onReset}>
              Reset setup
            </Button>
          </Tooltip>
        </Group>
      </Card>

      {/* Sticky recommendation readout — the long setup pane means a factor toggle near the top moves the
          number well off-screen; this pins the current figure so every edit shows its effect at a glance. */}
      {readout && recommended != null && basePay != null && (
        <Box
          style={{
            position: 'sticky', bottom: 0, zIndex: Z.local,
            marginInline: 'calc(-1 * var(--mantine-spacing-md))', marginBottom: 'calc(-1 * var(--mantine-spacing-md))',
            padding: '10px var(--mantine-spacing-md)',
            background: 'var(--mantine-color-body)',
            borderTop: '1px solid var(--mantine-color-default-border)',
          }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Eyebrow>Recommended</Eyebrow>
            <Text size="sm" fw={700} c="pos">
              {usd(recommended)}
              {recommended > basePay && <Text span c="dimmed" fw={600}> (+{pct((recommended - basePay) / basePay)})</Text>}
            </Text>
          </Group>
        </Box>
      )}
    </Stack>
  );
}

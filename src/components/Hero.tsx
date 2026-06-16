import { Box, Title, Text, type MantineSpacing } from '@mantine/core';
import { HERO_GRADIENT } from '../theme';

/** Gradient header band for the landing/section tops. */
export function Hero({ title, subtitle, mb = 'lg' }: { title: string; subtitle?: string; mb?: MantineSpacing }) {
  return (
    <Box
      p="xl"
      mb={mb}
      style={{ background: HERO_GRADIENT, borderRadius: 'var(--mantine-radius-lg)', color: 'white' }}
    >
      <Title order={1} c="white" style={{ letterSpacing: '-0.02em' }}>
        {title}
      </Title>
      {subtitle && (
        <Text c="white" mt={6} style={{ opacity: 0.92, maxWidth: 640 }}>
          {subtitle}
        </Text>
      )}
    </Box>
  );
}

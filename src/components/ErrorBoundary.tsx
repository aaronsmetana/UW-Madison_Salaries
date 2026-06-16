import { Component, type ReactNode } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';

interface State {
  error: Error | null;
}

/** Catches render errors in a route so one broken view can't blank the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Stack p="xl" maw={640}>
          <Alert color="red" title="Something went wrong on this view">
            <Text size="sm">{this.state.error.message}</Text>
          </Alert>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </Stack>
      );
    }
    return this.props.children;
  }
}

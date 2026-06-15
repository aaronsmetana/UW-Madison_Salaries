import { lazy } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { theme } from './theme';
import { ControlsProvider } from './state/controls';
import { TrayProvider } from './state/tray';
import { AppShellLayout } from './app/AppShell';

// Lazy-loaded routes → each becomes its own chunk (smaller initial bundle).
const Explore = lazy(() => import('./routes/Explore'));
const Compare = lazy(() => import('./routes/Compare'));
const Reports = lazy(() => import('./routes/Reports'));
const DataHealth = lazy(() => import('./routes/DataHealth'));
const Person = lazy(() => import('./routes/Person'));
const School = lazy(() => import('./routes/School'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShellLayout />,
      children: [
        { index: true, element: <Explore /> },
        { path: 'compare', element: <Compare /> },
        { path: 'reports', element: <Reports /> },
        { path: 'data', element: <DataHealth /> },
        { path: 'person/:id', element: <Person /> },
        { path: 'school/:id', element: <School /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <ControlsProvider>
          <TrayProvider>
            <RouterProvider router={router} />
          </TrayProvider>
        </ControlsProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}

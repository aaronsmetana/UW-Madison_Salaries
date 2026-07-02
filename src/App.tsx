import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate, useParams } from 'react-router-dom';
import { theme } from './theme';
import { ControlsProvider } from './state/controls';
import { TrayProvider } from './state/tray';
import { AppShellLayout } from './app/AppShell';
import { lazyWithRetry } from './lib/lazyRetry';

// Lazy-loaded routes → each becomes its own chunk (smaller initial bundle).
const Home = lazyWithRetry(() => import('./routes/Home'));
const PayCheck = lazyWithRetry(() => import('./routes/PayCheck'));
const Explore = lazyWithRetry(() => import('./routes/Explore'));
const Compare = lazyWithRetry(() => import('./routes/Compare'));
const Reports = lazyWithRetry(() => import('./routes/Reports'));
const DataHealth = lazyWithRetry(() => import('./routes/DataHealth'));
const Person = lazyWithRetry(() => import('./routes/Person'));
const School = lazyWithRetry(() => import('./routes/School'));

// The old /title/:code page is retired — titles now live at /paycheck?code=. Redirect so any
// bookmarked or shared /title links still resolve to the canonical Search-Title-Salaries view.
function TitleRedirect() {
  const { code } = useParams();
  return <Navigate to={`/paycheck?code=${encodeURIComponent(code ?? '')}`} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 } },
});

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: (
        <ControlsProvider>
          <TrayProvider>
            <AppShellLayout />
          </TrayProvider>
        </ControlsProvider>
      ),
      children: [
        { index: true, element: <Home /> },
        { path: 'paycheck', element: <PayCheck /> },
        { path: 'explore', element: <Explore /> },
        { path: 'compare', element: <Compare /> },
        { path: 'reports', element: <Reports /> },
        { path: 'data', element: <DataHealth /> },
        { path: 'person/:id', element: <Person /> },
        { path: 'school/:id', element: <School /> },
        { path: 'title/:code', element: <TitleRedirect /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  );
}

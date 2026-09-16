import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout } from '@/components/layouts/app-layout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apolloClient } from '@/lib/apollo';
import { getToken } from '@/lib/auth';
import { DocumentRoute } from '@/routes/document';
import { DocumentsRoute } from '@/routes/documents';
import { LoginPage } from '@/routes/login';
import { SettingsRoute } from '@/routes/settings';
import { VerifyPage } from '@/routes/verify';
import './index.css';

/**
 * No token, no request: an expired one is caught by the error link instead.
 *
 * The shell goes on here rather than around each route, so "signed in" and "has
 * the sidebar" cannot drift apart — and /login and /auth/verify, which are the
 * two pages with nothing to navigate to, stay bare.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  return getToken() ? <AppLayout>{children}</AppLayout> : <Navigate to="/login" replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={apolloClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/verify" element={<VerifyPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <DocumentsRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/documents/:id"
              element={
                <RequireAuth>
                  <DocumentRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsRoute />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ApolloProvider>
  </StrictMode>,
);

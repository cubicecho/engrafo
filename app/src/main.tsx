import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout } from '@/components/layouts/app-layout';
import { useThemePreference } from '@/components/ui/theme-preference';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apolloClient } from '@/lib/apollo';
import { getToken } from '@/lib/auth';
import type { SlotNode } from '@/lib/utils';
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
function RequireAuth({ contentSlot }: { contentSlot: SlotNode }) {
  return getToken() ? <AppLayout contentSlot={contentSlot} /> : <Navigate to="/login" replace />;
}

/**
 * index.html has already painted the theme by now; this is what keeps it right
 * afterwards. While the preference is `system`, flipping the OS between light
 * and dark repaints the app without a reload.
 */
function ThemeSync() {
  useThemePreference();
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={apolloClient}>
      <TooltipProvider>
        <ThemeSync />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/verify" element={<VerifyPage />} />
            <Route path="/" element={<RequireAuth contentSlot={<DocumentsRoute />} />} />
            <Route path="/documents/:id" element={<RequireAuth contentSlot={<DocumentRoute />} />} />
            <Route path="/settings" element={<RequireAuth contentSlot={<SettingsRoute />} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ApolloProvider>
  </StrictMode>,
);

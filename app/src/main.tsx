import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/layouts/require-auth';
import { useThemePreference } from '@/components/ui/theme-preference';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apolloClient } from '@/lib/apollo';
import { ROUTES } from '@/lib/routes';
import { DocumentRoute } from '@/routes/document';
import { DocumentsRoute } from '@/routes/documents';
import { LoginPage } from '@/routes/login';
import { ProcessingRoute } from '@/routes/processing';
import { SettingsRoute } from '@/routes/settings';
import { SsoPage } from '@/routes/sso';
import { TrashRoute } from '@/routes/trash';
import { VerifyPage } from '@/routes/verify';
import './index.css';

/**
 * index.html has already painted the theme by now; this is what keeps it right
 * afterwards. While the preference is `system`, flipping the OS between light
 * and dark repaints the app without a reload.
 */
function ThemeSync() {
  useThemePreference();
  return null;
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element to mount the app in');
}

createRoot(root).render(
  <StrictMode>
    <ApolloProvider client={apolloClient}>
      <TooltipProvider>
        <ThemeSync />
        <BrowserRouter>
          <Routes>
            <Route path={ROUTES.login} element={<LoginPage />} />
            <Route path={ROUTES.verify} element={<VerifyPage />} />
            <Route path={ROUTES.sso} element={<SsoPage />} />
            <Route path={ROUTES.documents} element={<RequireAuth contentSlot={<DocumentsRoute />} />} />
            <Route path={ROUTES.document} element={<RequireAuth contentSlot={<DocumentRoute />} />} />
            <Route path={ROUTES.trash} element={<RequireAuth contentSlot={<TrashRoute />} />} />
            <Route path={ROUTES.processing} element={<RequireAuth contentSlot={<ProcessingRoute />} />} />
            <Route path={ROUTES.settings} element={<RequireAuth contentSlot={<SettingsRoute />} />} />
            <Route path="*" element={<Navigate to={ROUTES.documents} replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ApolloProvider>
  </StrictMode>,
);

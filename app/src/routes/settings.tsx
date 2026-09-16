import { useQuery } from '@apollo/client/react';
import { LogOut, Settings } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { clearToken } from '@/lib/auth';
import { formatBytes, formatDateTime } from '@/lib/format';
import { queryLike } from '@/lib/query';
import { isDark, setDark } from '@/lib/theme';

const SettingsPage = graphql(`
  query SettingsPage {
    me {
      id
      email
      createdAt
    }
    serverConfig {
      version
      maxUploadBytes
      acceptedMimeTypes
      ocrAvailable
      ocrDefault
    }
  }
`);

/** A label and its value, the way every row on this page is drawn. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

function AppearanceCard() {
  const themeId = useId();
  const [dark, setDarkState] = useState(isDark);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>Remembered in this browser. Without a choice here, your system setting wins.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={themeId}>Dark theme</Label>
          <Switch
            id={themeId}
            checked={dark}
            onCheckedChange={(checked) => {
              setDark(checked);
              setDarkState(checked);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const result = useQuery(SettingsPage);
  const { data } = result;

  return (
    <PageLayout
      icon={<Settings />}
      title="Settings"
      description="Your account and what this instance is configured to do."
      width="prose"
      content={
        <div className="flex flex-col gap-6 py-4">
          <QueryState query={queryLike(result)} what="your settings" count={data ? 1 : 0} />

          {data && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Account</CardTitle>
                  <CardDescription>
                    Signing out forgets this browser's session. Signing back in needs only your address.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col">
                    <Row label="Email" value={data.me.email} />
                    <Row label="Account created" value={formatDateTime(data.me.createdAt)} />
                  </div>
                  <Button
                    variant="outline"
                    className="self-start"
                    onClick={() => {
                      clearToken();
                      navigate('/login', { replace: true });
                    }}
                  >
                    <LogOut className="size-4" aria-hidden /> Sign out
                  </Button>
                </CardContent>
              </Card>

              <AppearanceCard />

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Uploads</CardTitle>
                  <CardDescription>
                    Set on the server, so this card is read-only. Change them in the environment and restart.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col">
                    <Row label="Maximum file size" value={formatBytes(data.serverConfig.maxUploadBytes)} />
                    <Row
                      label="OCR"
                      value={
                        data.serverConfig.ocrAvailable
                          ? `Available, ${data.serverConfig.ocrDefault ? 'on' : 'off'} by default`
                          : 'Unavailable — ocrmypdf is not installed'
                      }
                    />
                    <Row
                      label="Accepted types"
                      value={
                        <span className="font-mono text-xs">{data.serverConfig.acceptedMimeTypes.join(', ')}</span>
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">About</CardTitle>
                  <CardDescription>Worth quoting in a bug report.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col">
                    <Row label="Version" value={<span className="font-mono">{data.serverConfig.version}</span>} />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      }
    />
  );
}

import { useQuery } from '@apollo/client/react';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { SettingRow } from '@/components/setting-row';
import { Button } from '@/components/ui/button';
import { Settings } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { clearToken } from '@/lib/auth';
import { formatBytes, formatDate } from '@/lib/format';
import { queryLike } from '@/lib/query';

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

export function SettingsRoute() {
  const navigate = useNavigate();
  const result = useQuery(SettingsPage);
  const { data } = result;

  return (
    <PageLayout
      iconSlot={<Settings />}
      title="Settings"
      description="Your account and what this instance is configured to do."
      width="prose"
      contentSlot={
        <div className="flex flex-col gap-6 py-4">
          <QueryState query={queryLike(result)} what="your settings" count={data ? 1 : 0} />

          {data && (
            <>
              <CardLayout
                level={2}
                title="Account"
                description="Signing out forgets this browser's session. Signing back in needs only your address."
                contentSlot={
                  <DescriptionList
                    contentSlot={
                      <>
                        <PropertyRow label="Email" value={data.me.email} />
                        <PropertyRow label="Account created" value={formatDate(data.me.createdAt)} />
                      </>
                    }
                  />
                }
                footerActionsSlot={
                  <Button
                    variant="outline"
                    iconSlot={<LogOut />}
                    content="Sign out"
                    onClick={() => {
                      clearToken();
                      navigate('/login', { replace: true });
                    }}
                  />
                }
              />

              <CardLayout
                level={2}
                title="Appearance"
                contentSlot={
                  <SettingRow
                    title="Theme"
                    description="Remembered in this browser, not on your account — the same archive on a laptop at night and a desk monitor by day is allowed to look different."
                    actionSlot={({ titleId, descriptionId }) => (
                      <ThemePicker aria-labelledby={titleId} aria-describedby={descriptionId} />
                    )}
                  />
                }
              />

              <CardLayout
                level={2}
                title="Uploads"
                description="Set on the server, so this card is read-only. Change them in the environment and restart."
                contentSlot={
                  <DescriptionList
                    contentSlot={
                      <>
                        <PropertyRow label="Maximum file size" value={formatBytes(data.serverConfig.maxUploadBytes)} />
                        <PropertyRow
                          label="OCR"
                          value={
                            data.serverConfig.ocrAvailable
                              ? `Available, ${data.serverConfig.ocrDefault ? 'on' : 'off'} by default`
                              : 'Unavailable — ocrmypdf is not installed'
                          }
                        />
                        <PropertyRow
                          label="Accepted types"
                          value={data.serverConfig.acceptedMimeTypes.join(', ')}
                          valueClassName="font-mono text-xs"
                        />
                      </>
                    }
                  />
                }
              />

              <CardLayout
                level={2}
                title="About"
                description="Worth quoting in a bug report."
                contentSlot={
                  <DescriptionList
                    contentSlot={
                      <PropertyRow label="Version" value={data.serverConfig.version} valueClassName="font-mono" />
                    }
                  />
                }
              />
            </>
          )}
        </div>
      }
    />
  );
}

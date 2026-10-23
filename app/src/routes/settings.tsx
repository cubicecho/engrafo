import { useQuery } from '@apollo/client/react';
import { LogOut } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { McpSettings } from '@/components/domain/mcp-settings';
import { SsoSettings } from '@/components/domain/sso-pairing';
import { VisionSettingsCard } from '@/components/domain/vision-settings';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { SettingRow } from '@/components/setting-row';
import { Button } from '@/components/ui/button';
import { Settings } from '@/components/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemePicker } from '@/components/ui/theme-picker';
import { formatBytes, formatDate } from '@/lib/format';
import { FULL_WIDTH_BODY } from '@/lib/page';
import { queryLike } from '@/lib/query';
import { useSignOut } from '@/lib/sign-out';
import { cn } from '@/lib/utils';

const SettingsPage = graphql(`
  query SettingsPage {
    me {
      id
      email
      createdAt
      isAdmin
    }
    serverConfig {
      version
      maxUploadBytes
      acceptedMimeTypes
      ocrAvailable
      ocrDefault
      visionAvailable
      visionAuto
    }
  }
`);

/** The query-string key that holds the open tab, so a tab can be linked and survives a reload. */
export const SETTINGS_TAB_PARAM = 'tab';

/** The tabs, in order. The first is where an absent or unknown `?tab=` lands. */
export const SETTINGS_TABS = [
  { value: 'account', label: 'Account', adminOnly: false },
  { value: 'processing', label: 'Processing', adminOnly: false },
  { value: 'mcp', label: 'MCP', adminOnly: false },
  { value: 'sign-in', label: 'Sign-in', adminOnly: true },
  { value: 'about', label: 'About', adminOnly: false },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['value'];

/**
 * The tab `?tab=` names, if this reader has it, else the first. While the page is still loading
 * `isAdmin` is unknown, and the admin's tab is kept rather than snapping to the first.
 */
export function settingsTabOf(requested: string | null, isAdmin: boolean | undefined): SettingsTab {
  const tab = SETTINGS_TABS.find((entry) => entry.value === requested);
  if (tab === undefined || (tab.adminOnly && isAdmin === false)) {
    return SETTINGS_TABS[0].value;
  }
  return tab.value;
}

/** The link a tab is: this page, with only the tab in its query string. */
function tabSearch(tab: SettingsTab): string {
  return tab === SETTINGS_TABS[0].value ? '' : `?${new URLSearchParams({ [SETTINGS_TAB_PARAM]: tab })}`;
}

/**
 * The account, the theme, and what the server is configured to do, a tab each. The theme can be
 * changed here, and the admin can set up the vision model and pair a sign-in provider; the rest
 * is read from the server's environment. The open tab is in the URL (`?tab=processing`).
 */
export function SettingsRoute() {
  const signOut = useSignOut();
  const result = useQuery(SettingsPage);
  const { data } = result;
  const [params] = useSearchParams();
  const isAdmin = data?.me.isAdmin;
  const tab = settingsTabOf(params.get(SETTINGS_TAB_PARAM), isAdmin);
  // How people sign in is the instance's, so only the admin is shown the tab.
  const tabs = SETTINGS_TABS.filter((entry) => entry.adminOnly === false || isAdmin !== false);

  return (
    <Tabs value={tab} className="h-full">
      <PageLayout
        iconSlot={<Settings />}
        title="Settings"
        description="Your account and what this instance is configured to do."
        width="full"
        headerContentSlot={
          <TabsList aria-label="Settings">
            {tabs.map((entry) => (
              <TabsTrigger
                key={entry.value}
                value={entry.value}
                linkSlot={<Link to={{ search: tabSearch(entry.value) }} replace />}
              >
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        contentClassName={cn(FULL_WIDTH_BODY, 'gap-6')}
        contentSlot={
          <>
            {/* Inside the open tab's panel, so the tab names the region that is loading or failed. */}
            {data ? null : (
              <TabsContent value={tab}>
                <QueryState query={queryLike(result)} what="your settings" count={0} />
              </TabsContent>
            )}

            {data && (
              <>
                <TabsContent value="account" className="flex flex-col gap-6">
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
                      <Button variant="outline" iconSlot={<LogOut />} content="Sign out" onClick={signOut} />
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
                </TabsContent>

                <TabsContent value="processing" className="flex flex-col gap-6">
                  <VisionSettingsCard
                    isAdmin={data.me.isAdmin}
                    available={data.serverConfig.visionAvailable}
                    auto={data.serverConfig.visionAuto}
                  />

                  <CardLayout
                    level={2}
                    title="Uploads"
                    description="Set on the server, so this card is read-only. Change them in the environment and restart."
                    contentSlot={
                      <DescriptionList
                        contentSlot={
                          <>
                            <PropertyRow
                              label="Maximum file size"
                              value={formatBytes(data.serverConfig.maxUploadBytes)}
                            />
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
                </TabsContent>

                <TabsContent value="mcp" className="flex flex-col gap-6">
                  <McpSettings />
                </TabsContent>

                {data.me.isAdmin ? (
                  <TabsContent value="sign-in" className="flex flex-col gap-6">
                    <SsoSettings />
                  </TabsContent>
                ) : null}

                <TabsContent value="about" className="flex flex-col gap-6">
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
                </TabsContent>
              </>
            )}
          </>
        }
      />
    </Tabs>
  );
}

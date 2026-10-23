import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { graphql } from '@/__generated__';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { CreateApiKeyDialog } from '@/components/domain/create-api-key-dialog';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { QueryState } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Plus } from '@/components/ui/icons';
import { messageOf } from '@/lib/error-message';
import { formatAgo, formatDate, joinStats } from '@/lib/format';
import { queryLike } from '@/lib/query';

const ApiKeys = graphql(`
  query ApiKeys {
    apiKeys {
      id
      name
      start
      lastUsedAt
      expiresAt
      createdAt
    }
  }
`);

const RevokeApiKey = graphql(`
  mutation RevokeApiKey($id: UUID!) {
    revokeApiKey(id: $id)
  }
`);

/** Where MCP clients connect: this instance's own origin, the address the browser used. */
export const MCP_PATH = '/mcp';

interface ApiKeyRow {
  lastUsedAt?: unknown;
  expiresAt?: unknown;
  createdAt: unknown;
}

/** A key's dates on one line. */
function keyDetails(key: ApiKeyRow): string {
  return joinStats(
    key.lastUsedAt ? `Last used ${formatAgo(String(key.lastUsedAt))}` : 'Never used',
    key.expiresAt ? `Expires ${formatDate(String(key.expiresAt))}` : 'Never expires',
    `Made ${formatDate(String(key.createdAt))}`,
  );
}

/**
 * The MCP card: where an agent connects, and the API keys it connects with. Which folders it may
 * read is chosen on the documents page, one folder at a time, so this card says so rather than
 * listing them.
 */
export function McpSettings() {
  const result = useQuery(ApiKeys);
  const [revokeApiKey] = useMutation(RevokeApiKey);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const keys = result.data?.apiKeys ?? [];
  const endpoint = `${globalThis.location?.origin ?? ''}${MCP_PATH}`;

  async function revoke(id: string) {
    setFailure(undefined);
    try {
      await revokeApiKey({ variables: { id } });
      await result.refetch();
    } catch (error) {
      setFailure(messageOf(error) ?? 'The server refused it');
    }
  }

  return (
    <>
      <CardLayout
        level={2}
        title="MCP"
        description="An AI agent — Claude Code, Claude Desktop, any MCP client — can list, search and read the folders you share, and nothing else. Share a folder from its menu on the documents page; sharing one shares the folders inside it."
        actionSlot={
          <Button size="sm" variant="outline" iconSlot={<Plus />} content="New key" onClick={() => setCreating(true)} />
        }
        contentSlot={
          <div className="grid gap-4">
            <DescriptionList
              contentSlot={
                <PropertyRow
                  label="Endpoint"
                  value={endpoint}
                  valueClassName="font-mono text-xs"
                  hint="Streamable HTTP. Send a key as Authorization: Bearer."
                  actionSlot={<CopyButton value={endpoint} label="Copy endpoint URL" />}
                />
              }
            />
            {failure && <Alert variant="destructive" title="Could not revoke the key" description={failure} />}
            {keys.length === 0 ? (
              <QueryState
                compact
                query={queryLike(result)}
                what="your API keys"
                count={keys.length}
                emptySlot={<EmptyState compact title="No keys yet. Make one for each MCP client." />}
              />
            ) : (
              <List
                label="API keys"
                contentSlot={keys.map((key) => (
                  <ListItem
                    key={key.id}
                    title={key.name}
                    description={keyDetails(key)}
                    meta={<span className="font-mono text-foreground/60 text-xs">{`${key.start}…`}</span>}
                    actionSlot={
                      <ConfirmButton
                        size="sm"
                        variant="outline"
                        content="Revoke"
                        title={`Revoke “${key.name}”?`}
                        description="Every MCP client using this key is refused from its next call. The key cannot be brought back; make a new one instead."
                        confirmLabel="Revoke"
                        onConfirm={() => void revoke(key.id)}
                      />
                    }
                  />
                ))}
              />
            )}
          </div>
        }
      />

      {creating && (
        <CreateApiKeyDialog endpoint={endpoint} onCreated={() => result.refetch()} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

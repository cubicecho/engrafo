import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { graphql } from '@/__generated__';
import { InputField, SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';

const CreateApiKey = graphql(`
  mutation CreateApiKey($name: String!, $expiresInDays: Int) {
    createApiKey(name: $name, expiresInDays: $expiresInDays) {
      key
      apiKey {
        id
      }
    }
  }
`);

/** The expiry choice for a key that never expires: it sends no `expiresInDays`. */
const NO_EXPIRY = 'never';

/** How long a key lasts: a number of days, or `NO_EXPIRY`. */
const EXPIRY_OPTIONS = [
  { value: NO_EXPIRY, label: 'Never' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

/** The longest name the server takes. */
const NAME_MAX_LENGTH = 60;

interface CreateApiKeyDialogProps {
  /** Where an MCP client connects, for the snippets shown with the new key. */
  endpoint: string;
  /** Called once a key exists, so the list can show it. */
  onCreated: () => Promise<unknown>;
  onClose: () => void;
}

/** What to paste to add Engrafo to Claude Code with this key. */
export function claudeCodeCommand(endpoint: string, key: string): string {
  return `claude mcp add --transport http engrafo ${endpoint} --header "Authorization: Bearer ${key}"`;
}

/** The same, as the `mcpServers` entry most other clients read. */
export function mcpJson(endpoint: string, key: string): string {
  const config = {
    mcpServers: { engrafo: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${key}` } } },
  };
  return JSON.stringify(config, null, 2);
}

/**
 * Makes an API key in two steps: its name and how long it lasts, then the key itself, shown this
 * once with what to paste into an MCP client. Only the key's hash is stored, so closing the
 * dialog is the last chance to copy it. Mounted only while open, so each opening starts blank.
 */
export function CreateApiKeyDialog({ endpoint, onCreated, onClose }: CreateApiKeyDialogProps) {
  const [key, setKey] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>();
  const [createApiKey] = useMutation(CreateApiKey);

  const form = useAppForm({
    defaultValues: { name: '', expiry: NO_EXPIRY },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        const result = await createApiKey({
          variables: {
            name: value.name.trim(),
            expiresInDays: value.expiry === NO_EXPIRY ? null : Number(value.expiry),
          },
        });
        const made = result.data?.createApiKey.key;
        if (made) {
          setKey(made);
          await onCreated();
        }
      } catch (error) {
        setRefusal(messageOf(error) ?? 'The server refused it');
      }
    },
  });

  const onOpenChange = (open: boolean) => {
    if (open === false) {
      onClose();
    }
  };

  if (key !== null) {
    const command = claudeCodeCommand(endpoint, key);
    const json = mcpJson(endpoint, key);
    return (
      <DialogLayout
        open
        onOpenChange={onOpenChange}
        title="Your new API key"
        description="An MCP client with it can list, search and read the folders you share — nothing else."
        contentSlot={
          <div className="grid gap-4">
            <Alert
              variant="warning"
              title="Copy it now"
              description="Only its hash is kept, so it will not be shown again. A lost key is revoked and replaced."
            />
            <CodeBlock
              title="API key"
              content={key}
              wrap
              actionSlot={<CopyButton value={key} label="Copy API key" />}
            />
            <CodeBlock
              title="Claude Code"
              language="bash"
              content={command}
              wrap
              actionSlot={<CopyButton value={command} label="Copy Claude Code command" />}
            />
            <CodeBlock
              title=".mcp.json"
              language="json"
              content={json}
              actionSlot={<CopyButton value={json} label="Copy .mcp.json" />}
            />
          </div>
        }
        footerActionsSlot={(close) => <Button content="Done" onClick={close} />}
      />
    );
  }

  return (
    <form.AppForm>
      <DialogLayout
        open
        onOpenChange={onOpenChange}
        title="New API key"
        description="For one MCP client: Claude Code, Claude Desktop, or any other. Give each client its own, so one can be revoked alone."
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <InputField
              form={form}
              name="name"
              label="Name"
              placeholder="Claude Code on my laptop"
              required
              autoFocus
              maxLength={NAME_MAX_LENGTH}
              validators={{ onSubmit: ({ value }) => (value.trim() === '' ? 'Give the key a name' : undefined) }}
            />
            <SelectField form={form} name="expiry" label="Expires" options={EXPIRY_OPTIONS} />
            {refusal && <Alert variant="destructive" title="Could not make the key" description={refusal} />}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content="Make key" pendingLabel="Making…" />
          </>
        )}
      />
    </form.AppForm>
  );
}

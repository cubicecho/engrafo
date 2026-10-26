import { useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useState } from 'react';
import { graphql } from '@/__generated__';
import { VisionImageDetail, type VisionSettingsInput, type VisionSettingsQuery } from '@/__generated__/graphql';
import { ComboboxField, InputField, NumberField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { Disclosure } from '@/components/disclosure';
import { PasswordField } from '@/components/password-field';
import { QueryState } from '@/components/query-state';
import { RadioGroupField } from '@/components/radio-group-field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { formatCount } from '@/lib/format';
import { queryLike } from '@/lib/query';
import { type EndpointModels, useEndpointModels } from '@/lib/vision-models';

// The vision model re-reads what OCR made of a scan, page by page, with any
// OpenAI-compatible server. Only the admin may see or change how it is set up
// (`visionSettings` is FORBIDDEN to anyone else), so everyone else is told what
// the instance does from `serverConfig` and is never sent to ask.

export const VisionSettingsDocument = graphql(`
  query VisionSettings {
    visionSettings {
      baseUrl
      model
      hasApiKey
      auto
      requestTimeoutSeconds
      maxResponseTokens
      imageDetail
      temperature
      configured
    }
  }
`);

const SetVisionSettings = graphql(`
  mutation SetVisionSettings($input: VisionSettingsInput!) {
    setVisionSettings(input: $input) {
      baseUrl
      model
      hasApiKey
      auto
      requestTimeoutSeconds
      maxResponseTokens
      imageDetail
      temperature
      configured
    }
  }
`);

/** The server's own default for one page, in seconds, shown as the field's placeholder. */
export const VISION_TIMEOUT_DEFAULT_SECONDS = 600;

/** The server's own cap on one page's reply, in tokens, shown as the field's placeholder. */
export const VISION_MAX_RESPONSE_DEFAULT_TOKENS = 8192;
/** The bounds the server holds the cap to (`VISION_DEFAULTS`), checked here to say so before a save. */
const VISION_MAX_RESPONSE_MIN_TOKENS = 256;
const VISION_MAX_RESPONSE_MAX_TOKENS = 131_072;

/** The server's own temperature, shown as the field's placeholder. */
export const VISION_TEMPERATURE_DEFAULT = 0.6;
/** The highest the server takes (`VISION_DEFAULTS.maxTemperature`). */
const VISION_TEMPERATURE_MAX = 2;
const VISION_TEMPERATURE_STEP = 0.1;

const IMAGE_DETAILS = [
  {
    value: VisionImageDetail.Auto,
    label: 'Auto',
    description: 'The server decides. Most read the page at full size.',
  },
  {
    value: VisionImageDetail.High,
    label: 'High',
    description: 'The page at full size. Fine print is read; a large page is slow on a local model.',
  },
  {
    value: VisionImageDetail.Low,
    label: 'Low',
    description: 'The page scaled to fit 512×512. Much faster on a local model, but small text may be lost.',
  },
];

function isImageDetail(value: string): value is VisionImageDetail {
  return IMAGE_DETAILS.some((option) => option.value === value);
}

/** Known-good base URLs, as the line under the field says them. */
const BASE_URL_HELP =
  'Any OpenAI-compatible server: Ollama http://localhost:11434/v1, LM Studio http://localhost:1234/v1, vLLM http://localhost:8000/v1, OpenAI https://api.openai.com/v1, OpenRouter https://openrouter.ai/api/v1.';

const MODE_AUTO = 'auto';
const MODE_ASKED = 'asked';

const RUN_MODES = [
  {
    value: MODE_AUTO,
    label: 'Read automatically',
    description: 'Every document OCR runs on is read again by the model once OCR is done.',
  },
  {
    value: MODE_ASKED,
    label: 'Only when asked',
    description: 'Each PDF and image gets a "Read with vision model" button on its page.',
  },
];

type Settings = VisionSettingsQuery['visionSettings'];

interface VisionFormValues {
  baseUrl: string;
  /** Typed, never read back. Blank keeps whatever is stored. */
  apiKey: string;
  model: string | null;
  mode: string;
  /** Null is the server's default. */
  requestTimeoutSeconds: number | null;
  /** Null is the server's default. */
  maxResponseTokens: number | null;
  imageDetail: string;
  /** Null is the server's default. */
  temperature: number | null;
}

function toValues(settings: Settings): VisionFormValues {
  return {
    baseUrl: settings.baseUrl ?? '',
    apiKey: '',
    model: settings.model ?? null,
    mode: settings.auto ? MODE_AUTO : MODE_ASKED,
    requestTimeoutSeconds:
      settings.requestTimeoutSeconds === VISION_TIMEOUT_DEFAULT_SECONDS ? null : settings.requestTimeoutSeconds,
    maxResponseTokens:
      settings.maxResponseTokens === VISION_MAX_RESPONSE_DEFAULT_TOKENS ? null : settings.maxResponseTokens,
    imageDetail: settings.imageDetail,
    temperature: settings.temperature === VISION_TEMPERATURE_DEFAULT ? null : settings.temperature,
  };
}

/** What a save sends. A blank key is left out, which keeps the stored one. */
export function toInput(value: VisionFormValues): VisionSettingsInput {
  const apiKey = value.apiKey.trim();
  return {
    baseUrl: value.baseUrl.trim() || null,
    model: value.model?.trim() || null,
    auto: value.mode === MODE_AUTO,
    requestTimeoutSeconds: value.requestTimeoutSeconds,
    maxResponseTokens: value.maxResponseTokens,
    imageDetail: isImageDetail(value.imageDetail) ? value.imageDetail : VisionImageDetail.Auto,
    temperature: value.temperature,
    ...(apiKey ? { apiKey } : {}),
  };
}

/** The same settings, as an input, with one change: what "Remove key" and "Turn off" send. */
function storedInput(settings: Settings, change: Partial<VisionSettingsInput>): VisionSettingsInput {
  return {
    baseUrl: settings.baseUrl ?? null,
    model: settings.model ?? null,
    auto: settings.auto,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    maxResponseTokens: settings.maxResponseTokens,
    imageDetail: settings.imageDetail,
    temperature: settings.temperature,
    ...change,
  };
}

interface VisionSettingsCardProps {
  /** Whether the reader is the admin, who alone may read and change the settings. */
  isAdmin: boolean;
  /** `serverConfig.visionAvailable`: a model is set up. */
  available: boolean;
  /** `serverConfig.visionAuto`: it reads every OCR'd document by itself. */
  auto: boolean;
}

/**
 * Settings' vision model card: the form for the admin, one read-only line for everyone else.
 */
export function VisionSettingsCard({ isAdmin, available, auto }: VisionSettingsCardProps) {
  return isAdmin ? <VisionSettingsForm /> : <VisionSummary available={available} auto={auto} />;
}

/** What the instance does with a vision model, in words. */
export function visionSummary(available: boolean, auto: boolean): string {
  if (!available) {
    return 'Off';
  }
  return auto ? 'On, reads every OCR’d document automatically' : 'On, reads a document when asked from its page';
}

function VisionSummary({ available, auto }: { available: boolean; auto: boolean }) {
  return (
    <CardLayout
      level={2}
      title="Vision model"
      description="Reads scanned pages again with a model that sees them, for better text than OCR alone. Set up by the admin."
      contentSlot={
        <DescriptionList contentSlot={<PropertyRow label="Vision model" value={visionSummary(available, auto)} />} />
      }
    />
  );
}

/**
 * The line under the endpoint: a button to ask it for its models, and what it said.
 */
function EndpointStatus({
  endpoint,
  canLoad,
  onLoad,
}: {
  endpoint: EndpointModels;
  canLoad: boolean;
  onLoad: () => void;
}) {
  const { asked, loading, error, models } = endpoint;
  let said = null;
  if (error) {
    said = (
      <>
        <Badge variant="destructive-soft">Failed</Badge>
        <span className="min-w-0 flex-1 text-negative text-xs">{error}</span>
      </>
    );
  } else if (models) {
    said = (
      <>
        <Badge variant="positive-soft">Connected</Badge>
        <span className="min-w-0 flex-1 break-all text-foreground/60 text-xs">
          {formatCount(models.length, 'model')} at {asked?.baseUrl}
        </span>
      </>
    );
  } else if (canLoad === false) {
    said = <span className="text-foreground/60 text-xs">Give a base URL to list its models.</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <Button
        variant="outline"
        size="sm"
        disabled={canLoad === false || loading}
        loading={loading}
        loadingLabel="Asking…"
        onClick={onLoad}
        content={asked ? 'Reload models' : 'Load models'}
      />
      {said}
    </div>
  );
}

/** The admin's form, over the stored settings. */
function VisionSettingsForm() {
  const result = useQuery(VisionSettingsDocument);
  const settings = result.data?.visionSettings;
  return (
    <CardLayout
      level={2}
      title="Vision model"
      description="Reads scanned pages again with a model that sees them, for better text than OCR alone. Any OpenAI-compatible server will do, local or hosted."
      contentClassName="gap-4"
      contentSlot={
        settings ? (
          <VisionForm settings={settings} />
        ) : (
          <QueryState query={queryLike(result)} what="the vision model's settings" count={0} />
        )
      }
    />
  );
}

function VisionForm({ settings }: { settings: Settings }) {
  const [save] = useMutation(SetVisionSettings, {
    update(cache, { data }) {
      if (data) {
        cache.writeQuery({ query: VisionSettingsDocument, data: { visionSettings: data.setVisionSettings } });
      }
    },
    // `serverConfig.visionAvailable` and `visionAuto` move with a save, and the page holds them.
    refetchQueries: ['SettingsPage'],
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const endpoint = useEndpointModels();
  const initial = useMemo(() => toValues(settings), [settings]);

  async function send(input: VisionSettingsInput): Promise<boolean> {
    setError(null);
    setSaved(false);
    try {
      await save({ variables: { input } });
      setSaved(true);
      return true;
    } catch (cause) {
      setError(messageOf(cause) ?? 'The server refused it');
      return false;
    }
  }

  const form = useAppForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      await send(toInput(value));
    },
  });

  // A save writes new settings to the cache; the form starts over from them, key box blank.
  useEffect(() => {
    form.reset(initial);
  }, [initial, form]);

  const askModels = (force = false) => endpoint.ask(form.getFieldValue('baseUrl'), form.getFieldValue('apiKey'), force);

  // The stored endpoint's models are listed as soon as it is known, with the stored key.
  const storedBaseUrl = settings.baseUrl;
  const { ask } = endpoint;
  useEffect(() => {
    if (storedBaseUrl) {
      ask(storedBaseUrl, '');
    }
  }, [storedBaseUrl, ask]);

  async function removeKey() {
    setBusy(true);
    await send(storedInput(settings, { apiKey: '' }));
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    await send(storedInput(settings, { baseUrl: null, model: null }));
    setBusy(false);
  }

  const models = endpoint.models;
  const options = useMemo(
    () =>
      (models ?? []).map((model) => ({
        value: model.id,
        label: model.id,
        className: 'font-mono',
        meta: model.contextLength ? `${model.contextLength.toLocaleString()} ctx` : undefined,
      })),
    [models],
  );

  return (
    <form.AppForm>
      <FormElement onSubmit={() => form.handleSubmit()} className="gap-4">
        <InputField
          form={form}
          name="baseUrl"
          label="Base URL"
          type="url"
          placeholder="http://localhost:11434/v1"
          description={BASE_URL_HELP}
          autoComplete="off"
          listeners={{ onBlur: () => askModels() }}
        />
        <PasswordField
          form={form}
          name="apiKey"
          label="API key"
          autoComplete="off"
          placeholder={
            settings.hasApiKey ? 'A key is stored. Leave blank to keep it.' : 'None. A local server needs none.'
          }
          description="Sent as a bearer token. It is never shown again once saved."
          listeners={{
            onBlur: ({ value }) => {
              if (value.trim()) {
                askModels();
              }
            },
          }}
          actionSlot={
            settings.hasApiKey ? (
              <ConfirmButton
                size="sm"
                variant="destructive-outline"
                content="Remove key"
                loading={busy}
                title="Remove the stored API key?"
                description="The endpoint is asked without a key from then on. One that needs a key refuses every page until a new one is saved."
                confirmLabel="Remove key"
                onConfirm={() => void removeKey()}
              />
            ) : null
          }
        />
        <form.Subscribe selector={(state) => state.values.baseUrl}>
          {(baseUrl) => (
            <EndpointStatus endpoint={endpoint} canLoad={baseUrl.trim() !== ''} onLoad={() => askModels(true)} />
          )}
        </form.Subscribe>
        {options.length > 0 ? (
          <ComboboxField
            form={form}
            name="model"
            label="Model"
            description="One that reads images, such as qwen2.5vl or gpt-4o. A name the list does not have can be typed into its search."
            options={options}
            searchable
            freeText
            searchPlaceholder="Find or type a model…"
            clearable
            emptyLabel="None"
          />
        ) : (
          <InputField
            form={form}
            name="model"
            label="Model"
            placeholder="qwen2.5vl:7b"
            description="One that reads images. The endpoint's own list appears here once it answers."
            autoComplete="off"
          />
        )}
        <RadioGroupField form={form} name="mode" label="When it reads" options={RUN_MODES} />
        <Disclosure
          title="Advanced"
          contentSlot={
            <div className="flex flex-col gap-4">
              <NumberField
                form={form}
                name="requestTimeoutSeconds"
                label="Time per page (seconds)"
                integer
                min={1}
                placeholder={String(VISION_TIMEOUT_DEFAULT_SECONDS)}
                description="How long one page may take before the read fails. A large model on a CPU is slow."
                validators={{
                  onChange: ({ value }) => (value !== null && value < 1 ? 'At least one second' : undefined),
                }}
              />
              <NumberField
                form={form}
                name="maxResponseTokens"
                label="Longest reply (tokens)"
                integer
                min={VISION_MAX_RESPONSE_MIN_TOKENS}
                max={VISION_MAX_RESPONSE_MAX_TOKENS}
                placeholder={String(VISION_MAX_RESPONSE_DEFAULT_TOKENS)}
                description="Where one page's answer is cut off. A dense page of text is about 1,500 tokens; a model that starts repeating itself runs all the way to this, on every page."
                validators={{
                  onChange: ({ value }) => {
                    if (value === null) {
                      return undefined;
                    }
                    if (value < VISION_MAX_RESPONSE_MIN_TOKENS) {
                      return `At least ${VISION_MAX_RESPONSE_MIN_TOKENS.toLocaleString()} tokens`;
                    }
                    return value > VISION_MAX_RESPONSE_MAX_TOKENS
                      ? `At most ${VISION_MAX_RESPONSE_MAX_TOKENS.toLocaleString()} tokens`
                      : undefined;
                  },
                }}
              />
              <NumberField
                form={form}
                name="temperature"
                label="Temperature"
                min={0}
                max={VISION_TEMPERATURE_MAX}
                step={VISION_TEMPERATURE_STEP}
                placeholder={String(VISION_TEMPERATURE_DEFAULT)}
                description="How much randomness the model reads with, from 0 to 2. At 0 the same page reads the same way twice, but a thinking model can get stuck repeating itself until the reply is cut off."
                validators={{
                  onChange: ({ value }) => {
                    if (value === null) {
                      return undefined;
                    }
                    if (value < 0) {
                      return 'At least 0';
                    }
                    return value > VISION_TEMPERATURE_MAX ? `At most ${VISION_TEMPERATURE_MAX}` : undefined;
                  },
                }}
              />
              <RadioGroupField form={form} name="imageDetail" label="Image detail" options={IMAGE_DETAILS} />
            </div>
          }
        />
        {error ? <Alert variant="destructive" title="Could not save" description={error} /> : null}
        {saved && !error ? (
          <Alert
            variant="info"
            title="Saved"
            description={
              settings.configured ? 'Documents are read with this model from now on.' : 'The vision model is off.'
            }
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {settings.configured ? (
            <ConfirmButton
              variant="destructive-outline"
              content="Turn off"
              loading={busy}
              title="Turn the vision model off?"
              description="Documents are no longer read by it, and their pages lose the button that asks for it. Text it already read stays. The key and when it reads are kept for next time."
              confirmLabel="Turn off"
              onConfirm={() => void turnOff()}
            />
          ) : null}
          <form.SubmitButton content="Save" pendingLabel="Saving…" requireChanges />
        </div>
      </FormElement>
    </form.AppForm>
  );
}

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { VisionImageDetail, type VisionSettingsInput } from '@/__generated__/graphql';
import {
  VISION_MAX_RESPONSE_DEFAULT_TOKENS,
  VISION_TIMEOUT_DEFAULT_SECONDS,
  VisionSettingsCard,
} from './vision-settings';

/**
 * The vision model card, against a mock server built from the real SDL. The server keeps what is
 * saved and remembers every input it was sent, so a story can say what a Save actually asked for
 * — that a key left blank is left out, not sent as `''`, which would clear it.
 */

const OLLAMA = 'http://localhost:11434/v1';
const LM_STUDIO = 'http://localhost:1234/v1';
const QWEN_CONTEXT = 128_000;
const MODELS = [
  { id: 'qwen2.5vl:7b', contextLength: QWEN_CONTEXT },
  { id: 'gemma3:12b', contextLength: null },
];

interface StoredSettings {
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  auto: boolean;
  requestTimeoutSeconds: number;
  maxResponseTokens: number;
  imageDetail: VisionImageDetail;
}

const OFF: StoredSettings = {
  baseUrl: null,
  model: null,
  hasApiKey: false,
  auto: true,
  requestTimeoutSeconds: VISION_TIMEOUT_DEFAULT_SECONDS,
  maxResponseTokens: VISION_MAX_RESPONSE_DEFAULT_TOKENS,
  imageDetail: VisionImageDetail.Auto,
};
const ON_OLLAMA: StoredSettings = { ...OFF, baseUrl: OLLAMA, model: 'qwen2.5vl:7b' };

interface Server {
  /** Every `setVisionSettings` input, in order. */
  saves: VisionSettingsInput[];
  /** How many times `visionSettings` was asked. */
  reads: number;
  /** Every `visionModels` request, in order. */
  listings: { baseUrl: string; apiKey?: string | null }[];
  resolvers: object;
}

/** A server holding one set of settings, whose endpoint lists `MODELS` or refuses with `listError`. */
function server(initial: StoredSettings, listError?: string): Server {
  let stored = initial;
  const view = () => ({ ...stored, configured: Boolean(stored.baseUrl && stored.model) });
  const state: Server = {
    saves: [],
    reads: 0,
    listings: [],
    resolvers: {
      Query: {
        visionSettings: () => {
          state.reads += 1;
          return view();
        },
        visionModels: (_parent: unknown, args: { baseUrl: string; apiKey?: string | null }) => {
          state.listings.push(args);
          if (listError) {
            throw new Error(listError);
          }
          return MODELS;
        },
      },
      Mutation: {
        setVisionSettings: (_parent: unknown, args: { input: VisionSettingsInput }) => {
          const { input } = args;
          state.saves.push(input);
          stored = {
            baseUrl: input.baseUrl || null,
            model: input.model || null,
            hasApiKey: input.apiKey === undefined ? stored.hasApiKey : input.apiKey !== '',
            auto: input.auto,
            requestTimeoutSeconds: input.requestTimeoutSeconds ?? VISION_TIMEOUT_DEFAULT_SECONDS,
            maxResponseTokens: input.maxResponseTokens ?? VISION_MAX_RESPONSE_DEFAULT_TOKENS,
            imageDetail: input.imageDetail ?? VisionImageDetail.Auto,
          };
          return view();
        },
      },
    },
  };
  return state;
}

const meta = {
  title: 'Domain/VisionSettings',
  component: VisionSettingsCard,
  args: { isAdmin: true, available: true, auto: true },
} satisfies Meta<typeof VisionSettingsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const stored = server(ON_OLLAMA);

/** Set up already: the stored endpoint is asked for its models at once, and the model is picked from them. */
export const ListsStoredEndpoint: Story = {
  parameters: { apolloClient: { resolvers: stored.resolvers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Connected')).toBeInTheDocument();
    await expect(canvas.getByText(`2 models at ${OLLAMA}`)).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Base URL' })).toHaveValue(OLLAMA);
    await expect(canvas.getByRole('combobox', { name: /Model/ })).toHaveTextContent('qwen2.5vl:7b');
    // Asked with no key typed, so the server sends the stored one.
    await expect(stored.listings[0]).toEqual({ baseUrl: OLLAMA, apiKey: null });
    await expect(canvas.getByRole('radio', { name: /Read automatically/ })).toBeChecked();
    // Nothing changed yet, so there is nothing to save.
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

const picking = server(ON_OLLAMA);

/** Picking another model and "Only when asked" sends both, and leaves the blank key out. */
export const PicksAModelAndSaves: Story = {
  parameters: { apolloClient: { resolvers: picking.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await canvas.findByText('Connected');
    await userEvent.click(canvas.getByRole('combobox', { name: /Model/ }));
    await userEvent.click(await page.findByRole('option', { name: /gemma3:12b/ }));
    await userEvent.click(canvas.getByRole('radio', { name: /Only when asked/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await expect(await canvas.findByText('Saved')).toBeInTheDocument();
    await expect(picking.saves).toHaveLength(1);
    await expect(picking.saves[0]).toEqual({
      baseUrl: OLLAMA,
      model: 'gemma3:12b',
      auto: false,
      requestTimeoutSeconds: null,
      maxResponseTokens: null,
      imageDetail: VisionImageDetail.Auto,
    });
    await expect('apiKey' in (picking.saves[0] ?? {})).toBe(false);
  },
};

const tuning = server(ON_OLLAMA);

/** Under Advanced: a shorter cap on each reply and low detail, sent as the server spells them. */
export const SetsReplyLengthAndDetail: Story = {
  parameters: { apolloClient: { resolvers: tuning.resolvers } },
  play: async ({ canvas }) => {
    await canvas.findByText('Connected');
    await userEvent.click(canvas.getByRole('button', { name: 'Advanced' }));
    const cap = await canvas.findByRole('spinbutton', { name: /Longest reply/ });
    await expect(cap).toHaveAttribute('placeholder', String(VISION_MAX_RESPONSE_DEFAULT_TOKENS));
    await expect(canvas.getByRole('radio', { name: /^Auto/ })).toBeChecked();

    // Below the floor is refused here, before a save can be.
    await userEvent.type(cap, '100');
    await expect(await canvas.findByText('At least 256 tokens')).toBeInTheDocument();
    await userEvent.clear(cap);
    await userEvent.type(cap, '2048');
    await userEvent.click(canvas.getByRole('radio', { name: /^Low/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await expect(await canvas.findByText('Saved')).toBeInTheDocument();
    await expect(tuning.saves[0]).toMatchObject({ maxResponseTokens: 2048, imageDetail: VisionImageDetail.Low });
  },
};

const refusing = server(
  { ...OFF, baseUrl: LM_STUDIO },
  `Could not reach ${LM_STUDIO}: connect ECONNREFUSED 127.0.0.1:1234`,
);

/** An endpoint that will not list: the reason is shown, and a model can still be typed and saved. */
export const ListingFails: Story = {
  parameters: { apolloClient: { resolvers: refusing.resolvers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Failed')).toBeInTheDocument();
    await expect(canvas.getByText(/connect ECONNREFUSED/)).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Reload models' })).toBeEnabled();

    await userEvent.type(canvas.getByRole('textbox', { name: /Model/ }), 'llava:13b');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(refusing.saves).toHaveLength(1));
    await expect(refusing.saves[0]).toMatchObject({ baseUrl: LM_STUDIO, model: 'llava:13b', auto: true });
  },
};

const fresh = server(OFF);

/** Nothing set up: no endpoint to ask until one is typed, and leaving the field asks it. */
export const AsksWhenTheBaseUrlIsTyped: Story = {
  parameters: { apolloClient: { resolvers: fresh.resolvers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Give a base URL to list its models.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Load models' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();

    await userEvent.type(canvas.getByRole('textbox', { name: 'Base URL' }), OLLAMA);
    await userEvent.tab();
    await expect(await canvas.findByText(`2 models at ${OLLAMA}`)).toBeInTheDocument();
    await expect(canvas.getByRole('combobox', { name: /Model/ })).toBeInTheDocument();
  },
};

const keyed = server({ ...ON_OLLAMA, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', hasApiKey: true });

/** A stored key is never shown, the box says one is there, and removing it sends `apiKey: ''`. */
export const RemovesTheStoredKey: Story = {
  parameters: { apolloClient: { resolvers: keyed.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const key = await canvas.findByLabelText('API key');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('placeholder', expect.stringMatching(/A key is stored/));

    await userEvent.click(canvas.getByRole('button', { name: 'Remove key' }));
    const dialog = within(await page.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Remove key' }));

    await waitFor(() => expect(keyed.saves).toHaveLength(1));
    await expect(keyed.saves[0]).toMatchObject({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument());
  },
};

const forbidden = server(ON_OLLAMA);

/** Anyone but the admin is told what the instance does, and the admin-only query is never sent. */
export const ReadOnlyForOthers: Story = {
  args: { isAdmin: false, available: true, auto: false },
  parameters: { apolloClient: { resolvers: forbidden.resolvers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('On, reads a document when asked from its page')).toBeInTheDocument();
    await expect(canvas.queryByRole('textbox', { name: 'Base URL' })).not.toBeInTheDocument();
    await expect(forbidden.reads).toBe(0);
  },
};

/** Off, for someone who is not the admin. */
export const OffForOthers: Story = {
  args: { isAdmin: false, available: false, auto: false },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Off')).toBeInTheDocument();
  },
};

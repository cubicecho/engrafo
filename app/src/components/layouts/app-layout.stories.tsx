import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { PageLayout } from '@/components/page-layout';
import { AppLayout } from './app-layout';

/**
 * The shell, at the two routes it has and the two widths it has.
 *
 * Everything this component decides is decided by the URL and the viewport, neither of which a
 * prop can stand in for — which is why these stories set `parameters.router.initialEntries` and
 * a viewport instead of passing args. The claims are: exactly one nav row is marked current,
 * the sidebar is gone below `md` and its controls have moved into a header, and the page's own
 * body scrolls while the chrome around it does not.
 *
 * That last one is the reason these run in a real browser. `overflow-y-auto` on an element whose
 * height comes from a chain of `min-h-0` flex parents is not something jsdom has an opinion
 * about — it reports every height as zero — so the bug this is here to catch is invisible to it.
 */

function Page({ title }: { title: string }) {
  return (
    <PageLayout
      title={title}
      description="Placeholder body, long enough to need scrolling."
      content={
        <div className="flex flex-col gap-4 py-4">
          {Array.from({ length: 30 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filler, with no identity
            <p key={index} className="text-muted-foreground text-sm">
              Row {index + 1}
            </p>
          ))}
        </div>
      }
    />
  );
}

const meta = {
  title: 'Layouts/AppLayout',
  component: AppLayout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Only one row is current, ever. `Documents` carries `end`, so `/documents/:id` does not lift it. */
export const DocumentsRoute: Story = {
  args: { children: <Page title="Documents" /> },
  parameters: { router: { initialEntries: ['/'] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const current = canvas.getAllByRole('link', { current: 'page' });
    await expect(current).toHaveLength(1);
    await expect(current[0]).toHaveAccessibleName('Documents');
  },
};

export const SettingsRoute: Story = {
  args: { children: <Page title="Settings" /> },
  parameters: { router: { initialEntries: ['/settings'] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const current = canvas.getAllByRole('link', { current: 'page' });
    await expect(current).toHaveLength(1);
    await expect(current[0]).toHaveAccessibleName('Settings');
  },
};

/**
 * A document, not the list. Nothing is marked current — which is the intended answer, and the
 * reason `Documents` is declared `end`: without it both this and the list would light up, and
 * two lit rows read as a bug rather than as "you are one level down".
 */
export const OnADocument: Story = {
  args: { children: <Page title="Invoice.pdf" /> },
  parameters: { router: { initialEntries: ['/documents/3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e'] } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
  },
};

/**
 * Phone width. The sidebar is display:none and the same two destinations are icons in a header,
 * with sign-out and the theme toggle beside them — so nothing reachable on a desktop becomes
 * unreachable here.
 */
export const Narrow: Story = {
  args: { children: <Page title="Documents" /> },
  globals: { viewport: { value: 'mobile1' } },
  parameters: { router: { initialEntries: ['/'] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Both navs are in the DOM; only one is laid out. `getAllByRole` would find four links and
    // pass whatever the CSS did, so the assertion has to be about the box, not the markup.
    const sidebar = canvasElement.querySelector('aside') as HTMLElement;
    await expect(sidebar).not.toBeVisible();

    await expect(canvas.getByRole('banner')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);
  },
};

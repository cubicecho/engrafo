/**
 * What every `PageLayout width="full"` passes as `contentClassName`. At `full` cubeui's chassis
 * pads nothing, because its `px-4` comes with the `page` and `prose` columns; the page header
 * keeps its own, so without this the body runs to the edges while the title above it does not.
 */
export const FULL_WIDTH_BODY = 'px-4';

/**
 * A part that takes the height left to it, from `lg` up, where the page is beside its sidebar
 * column and a document's preview or text should run to the bottom of the window. Below `lg` the
 * columns stack, and a part as tall as the window would push the cards under it out of sight, so
 * there it keeps its own height. Every ancestor between the scrolling body and the part needs it,
 * or the height stops there.
 */
export const FILL_AT_LG = 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col';

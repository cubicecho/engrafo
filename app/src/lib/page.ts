/**
 * What every `PageLayout width="full"` passes as `contentClassName`. At `full` cubeui's chassis
 * pads nothing, because its `px-4` comes with the `page` and `prose` columns; the page header
 * keeps its own, so without this the body runs to the edges while the title above it does not.
 */
export const FULL_WIDTH_BODY = 'px-4';

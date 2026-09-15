import type { CodegenConfig } from '@graphql-codegen/cli';

// The SDL this reads is written by src/write_schema.ts, which builds the schema
// from the Drizzle tables — so `npm run codegen` regenerates both halves and the
// resolver types can never drift from the schema the server actually serves.
const config: CodegenConfig = {
  schema: './__generated__/schema.graphql',
  importExtension: '.ts',
  generates: {
    './__generated__/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        inputMaybeValue: 'T | undefined',
        contextType: '../src/context.ts#Context',
        scalars: {
          UUID: 'string',
        },
        avoidOptionals: {
          field: true,
          inputValue: false,
        },
      },
    },
  },
};

export default config;

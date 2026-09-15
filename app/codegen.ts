import type { CodegenConfig } from '@graphql-codegen/cli';

// Reads the SDL the server prints from its own Drizzle-derived schema, so the
// typed documents here cannot drift from what the API actually serves.
const config: CodegenConfig = {
  schema: '../server/__generated__/schema.graphql',
  documents: ['./src/**/*.ts', './src/**/*.tsx', '!./src/__generated__/**'],
  ignoreNoDocuments: true,
  generates: {
    'src/__generated__/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
      config: {
        avoidOptionals: {
          field: true,
        },
        useTypeImports: true,
        defaultScalarType: 'unknown',
        skipTypeNameForRoot: true,
        scalars: {
          // Timestamps cross the wire as ISO strings; nothing here needs a Date.
          DateTime: 'string',
          UUID: 'string',
        },
      },
    },
  },
};

export default config;

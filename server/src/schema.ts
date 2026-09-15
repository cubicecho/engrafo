import { db } from '@cubicecho/engrafo-db';
import { createSchema } from './build-schema.ts';

const { schema, entities } = createSchema(db);

export { schema, entities };

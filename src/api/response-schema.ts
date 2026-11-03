import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { AnySchema } from 'ajv';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

export function assertSchema(schema: AnySchema, value: unknown): void {
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const details = ajv.errorsText(validate.errors, { separator: '\n' });
    throw new Error(`Response did not match JSON Schema:\n${details}`);
  }
}

import assert from "node:assert/strict";
export function assertStrict(schema: any) {
  if (!schema || typeof schema !== "object") return;
  if (schema.properties) {
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    assert.equal(schema.additionalProperties, false);
    Object.values(schema.properties).forEach(assertStrict);
  }
  if (schema.items) assertStrict(schema.items);
  for (const key of ["anyOf", "oneOf", "allOf"]) (schema[key] ?? []).forEach(assertStrict);
}

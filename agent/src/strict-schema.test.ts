import { test } from "node:test";
import assert from "node:assert/strict";
import { strictSchema, restoreOptionalFields } from "./strict-schema.ts";
import { SCHEMA, REQUEST_SCHEMA } from "./brain.ts";
import { parseOps, TODO_OPS_SCHEMA } from "./todos.ts";

import { assertStrict } from "./fixtures/assert-strict.ts";
test("strict 스키마는 중첩 속성까지 required이며 원본을 바꾸지 않는다", () => {
  for (const schema of [SCHEMA, REQUEST_SCHEMA]) {
    const before = JSON.stringify(schema);
    assertStrict(strictSchema(schema));
    assert.equal(JSON.stringify(schema), before);
  }
});
test("optional 복원: 우선순위 변경은 다른 필드를 지우지 않고 명시적 null은 삭제로 유지", () => {
  const raw = [{ op: "edit", id: "user:test", title: null, priority: 1, link: { _cy_omitted: true }, note: { _cy_omitted: true }, description: null, source_ref: null }];
  const ops = restoreOptionalFields(raw, TODO_OPS_SCHEMA);
  assert.deepEqual(ops, [{ op: "edit", id: "user:test", priority: 1 }]);
  assert.equal(parseOps(ops).ok, true);
  assert.deepEqual(restoreOptionalFields([{ ...raw[0], note: null }], TODO_OPS_SCHEMA), [{ op: "edit", id: "user:test", priority: 1, note: null }]);
});

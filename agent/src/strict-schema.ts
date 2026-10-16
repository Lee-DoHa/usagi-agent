// OpenAI strict 출력용 변환. 생략과 명시적 null(메모·링크 삭제)을 구분해 되돌린다.
type Schema = Record<string, any>;
const OMIT = { type: "object", additionalProperties: false, required: ["_cy_omitted"], properties: { _cy_omitted: { type: "boolean", enum: [true] } } };
const nullable = (s: Schema): boolean => s.type === "null" || (Array.isArray(s.type) && s.type.includes("null")) || (s.anyOf ?? []).some(nullable);

export function strictSchema(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const s = raw as Schema, out = { ...s };
  for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[key])) out[key] = s[key].map(strictSchema);
  if (s.items) out.items = strictSchema(s.items);
  if (s.$defs) out.$defs = Object.fromEntries(Object.entries(s.$defs).map(([k, v]) => [k, strictSchema(v)]));
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, Schema>).map(([k, v]) => {
      const value = strictSchema(v);
      if (s.required?.includes(k)) return [k, value];
      const missing = nullable(v) ? OMIT : { type: "null" };
      return [k, { anyOf: [value, missing], description: `${v.description ?? ""} 생략할 때는 ${nullable(v) ? '{"_cy_omitted":true}' : "null"}을 반환한다. ${nullable(v) ? "명시적 null은 원래 필드의 삭제 의미를 유지한다." : ""}` }];
    }));
    out.required = Object.keys(s.properties);
    out.additionalProperties = false;
  }
  return out;
}

export function restoreOptionalFields(value: unknown, raw: unknown): any {
  if (!raw || typeof raw !== "object" || value === null || value === undefined) return value;
  const s = raw as Schema;
  if (Array.isArray(value)) return value.map((v) => restoreOptionalFields(v, s.items));
  if (s.anyOf) {
    const branch = s.anyOf.find((b: Schema) => b.type === typeof value || (b.type === "object" && typeof value === "object"));
    return branch ? restoreOptionalFields(value, branch) : value;
  }
  if (s.properties && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const prop = s.properties[k];
      if (prop && !s.required?.includes(k)) {
        if (v === null && !nullable(prop)) continue;
        if (nullable(prop) && v && typeof v === "object" && (v as any)._cy_omitted === true) continue;
      }
      out[k] = restoreOptionalFields(v, prop);
    }
    return out;
  }
  return value;
}

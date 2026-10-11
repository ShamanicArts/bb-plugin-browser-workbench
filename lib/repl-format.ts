import type { ReplPreview } from "./repl";

type Leaf = ReplPreview["properties"][number];

export function leafText(leaf: Pick<Leaf, "type" | "subtype" | "value">): string {
  if (leaf.type === "accessor") return "(...)";
  if (leaf.type === "string") return JSON.stringify(leaf.value ?? "");
  if (leaf.type === "function") return "ƒ";
  if (leaf.type === "undefined") return "undefined";
  return leaf.value ?? leaf.subtype ?? leaf.type;
}

const isList = (preview: ReplPreview) => preview.subtype === "array" || preview.subtype === "typedarray";

export function previewSummary(preview: ReplPreview): string {
  const more = preview.overflow ? ", …" : "";
  if (preview.entries) {
    const items = preview.entries.map(entry => (entry.key ? `${previewSummary(entry.key)} => ` : "") + previewSummary(entry.value));
    return `${preview.description ?? ""} {${items.join(", ")}${more}}`;
  }
  if (preview.type !== "object" || preview.subtype === "null" || preview.subtype === "node" || preview.subtype === "error" || preview.subtype === "regexp" || preview.subtype === "date")
    return preview.description ?? preview.type;
  if (isList(preview)) {
    const items = preview.properties.filter(property => /^\d+$/.test(property.name)).map(leafText);
    const label = preview.description?.replace(/^Array(?=\()/, "") ?? "";
    return `${label} [${items.join(", ")}${more}]`;
  }
  const prefix = preview.description && preview.description !== "Object" ? `${preview.description} ` : "";
  return `${prefix}{${preview.properties.map(property => `${property.name}: ${leafText(property)}`).join(", ")}${more}}`;
}

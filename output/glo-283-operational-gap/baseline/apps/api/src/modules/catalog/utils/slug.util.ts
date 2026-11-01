export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove non-word characters except spaces and hyphens
    .replace(/[\s_-]+/g, '-') // collapse spaces and underscores into a single hyphen
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

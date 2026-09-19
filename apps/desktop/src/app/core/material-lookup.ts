import type { MaterialDocument, MaterialSection } from '@focusloop/shared-types';

/**
 * The material behind a generated course.
 *
 * `generateCourse` names a course `course-<first 12 characters of the content hash>` and the parser
 * names the document `material-<the same 12 characters>`, so both come from one hash. Deriving the
 * link from the hash rather than matching titles is what keeps two imports that happen to share a
 * title from reading each other's text.
 *
 * A course that was not generated from an import, such as the built-in demo course, resolves to
 * nothing at all, which is why the callers below return `null` instead of an empty document.
 */
export function materialIdForCourse(courseId: string): string | null {
  const prefix = 'course-';
  return courseId.startsWith(prefix) ? `material-${courseId.slice(prefix.length)}` : null;
}

export function findMaterial(
  materials: readonly MaterialDocument[],
  courseId: string,
): MaterialDocument | null {
  const id = materialIdForCourse(courseId);
  if (id === null) return null;
  return materials.find((document) => document.id === id) ?? null;
}

/**
 * The section a concept was generated from.
 *
 * A concept is named after its section heading, so the heading is the link back. A material that
 * repeats a heading resolves to the first one, which is the same section `generateCourse` used.
 */
export function findSection(
  document: MaterialDocument | null,
  conceptTitle: string,
): MaterialSection | null {
  if (document === null) return null;
  return document.sections.find((section) => section.heading === conceptTitle) ?? null;
}

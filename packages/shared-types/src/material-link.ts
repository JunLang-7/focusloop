import type { MaterialDocument, MaterialSection } from './material';

/**
 * The link between a generated course and the material it came from.
 *
 * The generator names a course `course-<hash>` and the parser names the document `material-<hash>`
 * from the same content hash, so the hash is the link and nothing else is. A concept is named after
 * the section heading it was generated from, so the heading is the second link.
 *
 * These live with the contract rather than with either side because three call sites already needed
 * them and two of those had quietly drifted apart: one matched a concept title exactly, the other
 * after trimming and lower-casing. The difference was invisible until a heading had different
 * spacing — at which point the agent and the course page would describe different sections of the
 * same document and neither would look wrong on its own. A rule that two sides must agree on belongs
 * where both can reach it.
 */

const COURSE_PREFIX = 'course-';
const MATERIAL_PREFIX = 'material-';

/**
 * The document id behind a generated course id, or null when the course was not generated.
 *
 * Null rather than an empty string: the built-in demo course was not generated from anything, and a
 * caller that cannot tell those apart will look up a material that never existed and find nothing.
 */
export function materialIdForCourse(courseId: string): string | null {
  if (!courseId.startsWith(COURSE_PREFIX)) return null;
  const hash = courseId.slice(COURSE_PREFIX.length);
  return hash.length === 0 ? null : `${MATERIAL_PREFIX}${hash}`;
}

export function findMaterialForCourse(
  materials: readonly MaterialDocument[],
  courseId: string,
): MaterialDocument | null {
  const id = materialIdForCourse(courseId);
  if (id === null) return null;
  return materials.find((document) => document.id === id) ?? null;
}

/**
 * The section a concept was generated from, by exact heading.
 *
 * Exact, and deliberately not "the first section when nothing matches". A concept is named after its
 * section, so an exact match is a real link; a near miss is not a link at all, and a section about
 * something else is worse than no section, because an answer grounded in it comes back confident and
 * wrong. Callers that need to explain the absence get `null` and can say so.
 */
export function findSectionForConcept(
  document: MaterialDocument | null,
  conceptTitle: string | null,
): MaterialSection | null {
  if (document === null || conceptTitle === null) return null;
  return document.sections.find((section) => section.heading === conceptTitle) ?? null;
}

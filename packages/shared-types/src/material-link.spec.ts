import { describe, expect, it } from 'vitest';
import type { MaterialDocument } from './material';
import { findMaterialForCourse, findSectionForConcept, materialIdForCourse } from './material-link';

function document(sections: readonly { heading: string; body: string }[]): MaterialDocument {
  return {
    id: 'material-abcdef123456',
    title: 'Notes',
    format: 'markdown',
    source: 'imported',
    contentHash: 'abcdef123456',
    importedAt: '2026-09-20T00:00:00.000Z',
    warnings: [],
    sections: sections.map((section, order) => ({
      id: `sec${String(order)}`,
      heading: section.heading,
      body: section.body,
      order,
      depth: 1,
    })),
  };
}

describe('materialIdForCourse', () => {
  it('derives the document id from a generated course id', () => {
    expect(materialIdForCourse('course-abcdef123456')).toBe('material-abcdef123456');
  });

  it('has no document for a course that was not generated', () => {
    // The built-in demo course is not named after a hash. Answering with a plausible id instead of
    // null would send the caller looking for a document that never existed.
    expect(materialIdForCourse('demo-course')).toBeNull();
  });

  it('has no document for a course id with no hash in it', () => {
    expect(materialIdForCourse('course-')).toBeNull();
  });
});

describe('findMaterialForCourse', () => {
  it('finds the document behind a generated course', () => {
    const materials = [document([{ heading: 'Intro', body: 'x' }])];

    expect(findMaterialForCourse(materials, 'course-abcdef123456')?.id).toBe(
      'material-abcdef123456',
    );
  });

  it('finds nothing for a course that was not generated', () => {
    const materials = [document([{ heading: 'Intro', body: 'x' }])];

    expect(findMaterialForCourse(materials, 'demo-course')).toBeNull();
  });
});

describe('findSectionForConcept', () => {
  it('matches a heading exactly', () => {
    const found = findSectionForConcept(
      document([{ heading: 'Rotations', body: 'R' }]),
      'Rotations',
    );

    expect(found?.body).toBe('R');
  });

  it('takes the exact heading even when a closer-looking one comes first', () => {
    /*
     * The assertion that can fail. A rule that fell back to the first section, or that matched on
     * "the heading contains the title", would return the Rotations-in-brief section here. This is the
     * single point at which the agent could be handed the wrong part of the material, so it is the
     * one worth pinning.
     */
    const found = findSectionForConcept(
      document([
        { heading: 'Rotations in brief', body: 'BRIEF' },
        { heading: 'Rotations', body: 'EXACT' },
      ]),
      'Rotations',
    );

    expect(found?.body).toBe('EXACT');
  });

  it('does not match a heading that differs only by case', () => {
    // The drift this rule was moved here to end: one call site lower-cased both sides and the other
    // did not, so the agent and the course page could describe different sections.
    expect(
      findSectionForConcept(document([{ heading: 'rotations', body: 'R' }]), 'Rotations'),
    ).toBeNull();
  });

  it('does not match a heading that differs only by surrounding space', () => {
    expect(
      findSectionForConcept(document([{ heading: ' Rotations ', body: 'R' }]), 'Rotations'),
    ).toBeNull();
  });

  it('finds nothing when there is no document or no concept', () => {
    expect(findSectionForConcept(null, 'Rotations')).toBeNull();
    expect(findSectionForConcept(document([{ heading: 'Rotations', body: 'R' }]), null)).toBeNull();
  });
});

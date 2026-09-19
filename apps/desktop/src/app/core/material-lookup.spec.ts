import { describe, expect, it } from 'vitest';
import type { MaterialDocument } from '@focusloop/shared-types';
import { findMaterial, findSection, materialIdForCourse } from './material-lookup';

function material(overrides: Partial<MaterialDocument> = {}): MaterialDocument {
  return {
    id: 'material-abc123def456',
    title: '通信原理概论',
    format: 'markdown',
    source: 'imported',
    contentHash: `abc123def456${'0'.repeat(52)}`,
    importedAt: '2026-01-01T00:00:00.000Z',
    warnings: [],
    sections: [
      {
        id: 'sec-2',
        heading: '模拟调制',
        body: '模拟调制是把基带信号的频谱搬移到较高的载频上，以便在信道中有效辐射。',
        order: 1,
        depth: 2,
      },
    ],
    ...overrides,
  };
}

describe('materialIdForCourse', () => {
  it('derives the document id from the hash the course id already carries', () => {
    expect(materialIdForCourse('course-abc123def456')).toBe('material-abc123def456');
  });

  it('returns nothing for a course id that was not generated from a hash', () => {
    expect(materialIdForCourse('custom-1')).toBeNull();
  });
});

describe('findMaterial', () => {
  it('finds the document behind an imported course', () => {
    expect(findMaterial([material()], 'course-abc123def456')?.title).toBe('通信原理概论');
  });

  it('finds nothing when the material is not loaded', () => {
    expect(findMaterial([], 'course-abc123def456')).toBeNull();
  });

  // The built-in demo course keeps its readable id, so its derived material id matches nothing.
  it('finds nothing for the built-in demo course', () => {
    expect(findMaterial([material()], 'course-red-black-trees')).toBeNull();
  });
});

describe('findSection', () => {
  it('finds the section a concept was generated from', () => {
    const section = findSection(material(), '模拟调制');
    expect(section?.body).toBe(
      '模拟调制是把基带信号的频谱搬移到较高的载频上，以便在信道中有效辐射。',
    );
  });

  it('finds nothing for a heading the document does not have', () => {
    expect(findSection(material(), '抽样定理')).toBeNull();
  });

  it('finds nothing when there is no document', () => {
    expect(findSection(null, '模拟调制')).toBeNull();
  });
});

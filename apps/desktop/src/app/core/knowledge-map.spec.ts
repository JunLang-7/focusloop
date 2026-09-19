import { describe, expect, it } from 'vitest';
import type { Concept } from '@focusloop/shared-types';
import { MAP_WIDTH, SPINE_X, buildKnowledgeMap, recallScore } from './knowledge-map';

function concept(title: string, order = 0): Concept {
  return { id: `c-${order}`, title, summary: `${title} 的摘要。`, order, keyPoints: [] };
}

describe('buildKnowledgeMap', () => {
  it('puts the course above its concepts', () => {
    const map = buildKnowledgeMap('通信原理概论', [
      concept('信息与带宽', 0),
      concept('模拟调制', 1),
    ]);
    expect(map.root.label).toBe('通信原理概论');
    expect(map.nodes).toHaveLength(2);
    expect(map.nodes[0]?.y).toBeGreaterThan(map.root.y + map.root.height);
  });

  it('alternates sides so neighbours cannot overlap', () => {
    const map = buildKnowledgeMap('c', [concept('a', 0), concept('b', 1), concept('c', 2)]);
    expect(map.nodes.map((node) => node.side)).toEqual(['left', 'right', 'left']);
    expect((map.nodes[0]?.x ?? 0) + (map.nodes[0]?.width ?? 0)).toBeLessThan(SPINE_X);
    expect(map.nodes[1]?.x).toBeGreaterThan(SPINE_X);
  });

  it('keeps every node inside the drawing', () => {
    const map = buildKnowledgeMap('c', [concept('a', 0), concept('b', 1)]);
    for (const node of map.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(MAP_WIDTH);
      expect(node.y + node.height).toBeLessThanOrEqual(map.height);
    }
  });

  it('draws the spine plus one connector per concept', () => {
    const map = buildKnowledgeMap('c', [concept('a', 0), concept('b', 1), concept('c', 2)]);
    expect(map.lines).toHaveLength(4);
  });

  // The built-in demo course has concepts, an empty one does not; the caller hides the map rather
  // than rendering a lone box.
  it('has a spine but no connectors when there are no concepts', () => {
    const map = buildKnowledgeMap('c', []);
    expect(map.nodes).toEqual([]);
    expect(map.lines).toHaveLength(1);
    expect(map.height).toBeGreaterThan(0);
  });
});

describe('recallScore', () => {
  const concepts = [
    concept('信息与带宽：信息量、信噪比与频谱', 0),
    concept('模拟调制：AM 与 FM，带宽换信噪比', 1),
    concept('抽样与量化：模拟信号怎么变成数字', 2),
  ];

  it('counts a concept when the distinctive part of its title is written', () => {
    const { recalled, missed } = recallScore(concepts, '我记得抽样与量化那部分');
    expect(recalled.map((item) => item.title)).toEqual(['抽样与量化：模拟信号怎么变成数字']);
    expect(missed).toHaveLength(2);
  });

  it('ignores case, spacing and full-width punctuation', () => {
    const { recalled } = recallScore(concepts, '  模拟调制  ：  AM  与  FM ');
    expect(recalled).toHaveLength(1);
  });

  it('counts nothing as recalled when nothing is written', () => {
    const { recalled, missed } = recallScore(concepts, '   ');
    expect(recalled).toEqual([]);
    expect(missed).toHaveLength(3);
  });

  it('counts a concept once however often it is written', () => {
    const { recalled } = recallScore(concepts, '信息与带宽 ... 信息与带宽');
    expect(recalled).toHaveLength(1);
  });

  it('does not credit a concept for a couple of characters', () => {
    const { recalled } = recallScore(concepts, '信息');
    expect(recalled).toEqual([]);
  });
});

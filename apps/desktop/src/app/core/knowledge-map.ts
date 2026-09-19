import type { Concept } from '@focusloop/shared-types';

/**
 * Geometry for the course map.
 *
 * Pure and deterministic so the shape can be tested without rendering, the same way `session-plan`
 * turns minutes into pixel offsets. The renderer only binds the numbers it returns.
 *
 * Deliberately not a general graph layout: a course is an ordered list of concepts, and inventing
 * branches the material does not have would be decoration pretending to be structure. The material's
 * own heading depth could nest later, and this is the shape that would grow into it.
 */

export const MAP_WIDTH = 720;
export const NODE_WIDTH = 292;
export const NODE_HEIGHT = 44;
export const NODE_GAP = 12;
export const SPINE_X = MAP_WIDTH / 2;
export const ROOT_HEIGHT = 52;
export const TOP_PADDING = 16;
export const BOTTOM_PADDING = 16;

export interface MapBox {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Which side of the spine the node sits on. The root sits on neither. */
  readonly side: 'root' | 'left' | 'right';
}

export interface MapLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface KnowledgeMap {
  readonly width: number;
  readonly height: number;
  readonly root: MapBox;
  readonly nodes: readonly MapBox[];
  readonly lines: readonly MapLine[];
}

/**
 * Places the course at the top of a spine and its concepts down either side, in order.
 *
 * Concepts alternate sides so consecutive ones never overlap, and each one gets a horizontal
 * connector into the spine at its own vertical centre, which is what makes the whole thing read as
 * one object rather than as a list with a vertical rule.
 */
export function buildKnowledgeMap(courseTitle: string, concepts: readonly Concept[]): KnowledgeMap {
  const root: MapBox = {
    id: 'course',
    label: courseTitle,
    x: (MAP_WIDTH - NODE_WIDTH) / 2,
    y: TOP_PADDING,
    width: NODE_WIDTH,
    height: ROOT_HEIGHT,
    side: 'root',
  };

  const nodes: MapBox[] = concepts.map((concept, index) => {
    const side = index % 2 === 0 ? 'left' : 'right';
    const x = side === 'left' ? SPINE_X - NODE_WIDTH - 24 : SPINE_X + 24;
    return {
      id: concept.id,
      label: concept.title,
      x,
      y: root.y + root.height + NODE_GAP + index * (NODE_HEIGHT + NODE_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      side,
    };
  });

  const spineTop = root.y + root.height;
  const spineBottom =
    nodes.length === 0 ? spineTop : (nodes[nodes.length - 1]?.y ?? spineTop) + NODE_HEIGHT / 2;

  const lines: MapLine[] = [{ x1: SPINE_X, y1: spineTop, x2: SPINE_X, y2: spineBottom }];
  for (const node of nodes) {
    const y = node.y + node.height / 2;
    lines.push({
      x1: node.side === 'left' ? node.x + node.width : node.x,
      y1: y,
      x2: SPINE_X,
      y2: y,
    });
  }

  return {
    width: MAP_WIDTH,
    height:
      nodes.length === 0
        ? root.y + root.height + BOTTOM_PADDING
        : (nodes[nodes.length - 1]?.y ?? root.y) + NODE_HEIGHT + BOTTOM_PADDING,
    root,
    nodes,
    lines,
  };
}

/**
 * How much of the map the learner put back from memory.
 *
 * Case, spacing and full-width punctuation are ignored because the point is whether the idea came
 * back, not whether it was typed exactly. A concept counts as recalled when any distinctive part of
 * its title appears, which is why the comparison is by substring rather than equality: a learner who
 * writes "抽样定理" has recalled a concept called "抽样与量化：模拟信号怎么变成数字".
 */
export function recallScore(
  concepts: readonly Concept[],
  recalledText: string,
): { recalled: readonly Concept[]; missed: readonly Concept[] } {
  const haystack = normalize(recalledText);
  const recalled: Concept[] = [];
  const missed: Concept[] = [];
  for (const concept of concepts) {
    (matchKey(concept.title, haystack) ? recalled : missed).push(concept);
  }
  return { recalled, missed };
}

/** The longest run of characters in the title that the learner must have written for it to count. */
const MIN_KEY_CHARS = 2;

function matchKey(title: string, haystack: string): boolean {
  const needles = [title, ...title.split(/[:：·—\-—\s]+/)]
    .map((part) => normalize(part))
    .filter((part) => part.length >= MIN_KEY_CHARS)
    .sort((a, b) => b.length - a.length);
  return needles.some((needle) => haystack.includes(needle));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·、，,。.！!？?（）()【】"'`]/g, '');
}

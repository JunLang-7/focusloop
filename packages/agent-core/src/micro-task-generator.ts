import type { Concept, Course, MaterialDocument, MicroTask, Quiz } from '@focusloop/shared-types';
import { slugify } from '@focusloop/material-parser';

export interface GenerateCourseOptions {
  /** Deterministic override; defaults to a hash of the material. */
  readonly courseId?: string;
  /** Upper bound on concepts, to keep the session short by design. */
  readonly maxConcepts?: number;
  /** Minimum body length before a practice task is added. */
  readonly practiceMinChars?: number;
}

export interface GeneratedCourse {
  readonly course: Course;
  readonly warnings: readonly string[];
}

const DEFAULT_MAX_CONCEPTS = 6;
const DEFAULT_PRACTICE_MIN_CHARS = 120;

/**
 * The first sentence of a section, used as the concept summary and as a quiz option.
 *
 * The terminators include the full-width ones, and a full-width terminator does not have to be
 * followed by a space: Chinese does not put one after `。`, and requiring whitespace there made
 * every Chinese section fall through to the blunt 200-character cut. That cut landed mid-word,
 * and because the same string is the summary, the key point and the read instruction, one broken
 * sentence appeared three times — in the concept card, in the quiz options and in the task the
 * learner was asked to start with.
 *
 * An ASCII terminator still requires a space or the end of the string, so a decimal point or an
 * abbreviation does not end the sentence early.
 */
function firstSentence(body: string): string {
  const match = /^(.{20,240}?(?:[.!?](?=\s|$)|[。！？]))/s.exec(body.trim());
  return (match?.[1] ?? body.trim().slice(0, 200)).trim();
}

/**
 * The document's own title is not a concept.
 *
 * A Markdown file usually opens with `# Title` and a short blurb. The parser gives every heading a
 * section, so the blurb became concept one — titled exactly like the course, and generating a read
 * task that asked the learner to summarise the document's own preamble while the first real
 * concept waited behind it. A file with no `#` heading hits the same rule through the file name,
 * which is what the parser uses as the heading for the text before the first heading.
 */
function isDocumentTitle(heading: string, material: MaterialDocument): boolean {
  return heading === material.title;
}

function conceptSlug(title: string, index: number): string {
  const slug = slugify(title);
  return slug.length > 0 ? `c-${slug}` : `c-section-${index + 1}`;
}

/**
 * Deterministic micro-task generation — the "mock" path.
 *
 * It never calls a model: the same material always produces the same course, so
 * imports are reproducible and testable. A real provider can later enrich the
 * instructions, but it must not be required for the golden path.
 */
export function generateCourse(
  material: MaterialDocument,
  options: GenerateCourseOptions = {},
): GeneratedCourse {
  const warnings: string[] = [];
  const maxConcepts = options.maxConcepts ?? DEFAULT_MAX_CONCEPTS;
  const practiceMinChars = options.practiceMinChars ?? DEFAULT_PRACTICE_MIN_CHARS;

  const usable = material.sections
    .filter((section) => section.body.trim().length > 0)
    .filter((section) => !isDocumentTitle(section.heading, material))
    .slice(0, maxConcepts);

  if (usable.length === 0) {
    warnings.push('No readable sections were found, so no micro tasks were generated.');
  }
  if (material.sections.length > maxConcepts) {
    warnings.push(
      `Only the first ${maxConcepts} sections were used; the rest stays in the material.`,
    );
  }

  const courseId = options.courseId ?? `course-${material.contentHash.slice(0, 12)}`;
  const seen = new Set<string>();

  const concepts: Concept[] = usable.map((section, index) => {
    let id = conceptSlug(section.heading, index);
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id,
      title: section.heading,
      summary: firstSentence(section.body),
      order: index,
      /*
       * Deliberately empty. This used to be `[firstSentence(section.body)]`, which is the same
       * string as `summary`, so the course page rendered every concept's opening sentence twice:
       * once as the summary paragraph and once as its only key point. A key point that repeats the
       * summary is not a key point, and inventing extra ones would trade the duplication for a wall
       * of text. The card is title plus one line until there is something real to put here.
       */
      keyPoints: [],
    };
  });

  const microTasks: MicroTask[] = [];
  const quizzes: Quiz[] = [];

  usable.forEach((section, index) => {
    const concept = concepts[index]!;
    const body = section.body.trim();

    microTasks.push({
      id: `${courseId}-t${microTasks.length + 1}`,
      courseId,
      conceptId: concept.id,
      title: `Read: ${section.heading}`,
      instructions: `Read this section and summarise it in one sentence: "${firstSentence(body)}"`,
      kind: 'read',
      estimatedMinutes: 3,
      order: microTasks.length,
    });

    if (body.length >= practiceMinChars) {
      microTasks.push({
        id: `${courseId}-t${microTasks.length + 1}`,
        courseId,
        conceptId: concept.id,
        title: `Practise: ${section.heading}`,
        instructions: `Explain "${section.heading}" using a concrete example you invent yourself.`,
        kind: 'practice',
        estimatedMinutes: 5,
        order: microTasks.length,
      });
    }
  });

  // One check question per concept, built from that concept's key sentence.
  const sentences = concepts.map((concept) => concept.summary);
  concepts.forEach((concept, index) => {
    const distractors = sentences.filter((_, other) => other !== index).slice(0, 2);
    if (distractors.length < 2) return;

    const options = [concept.summary, ...distractors];
    // Deterministic rotation so the correct answer is not always first.
    const shift = index % options.length;
    const rotated = [...options.slice(shift), ...options.slice(0, shift)];

    const quizTaskId = `${courseId}-t${index * 2 + 2}`;
    const quizTask = microTasks.find((task) => task.id === quizTaskId);
    if (quizTask === undefined) return;

    quizzes.push({
      id: `${courseId}-q${index + 1}`,
      taskId: quizTaskId,
      conceptId: concept.id,
      question: `Which statement belongs to "${concept.title}"?`,
      options: rotated,
      answerIndex: rotated.indexOf(concept.summary),
      explanation: `${concept.title}: ${concept.summary}`,
    });
  });

  const course: Course = {
    id: courseId,
    title: material.title,
    description: `Generated from ${material.title} (${material.format}).`,
    concepts,
    microTasks,
    quizzes,
  };

  return { course, warnings };
}

/** Convenience wrapper for callers that only need the tasks. */
export function generateMicroTasks(
  material: MaterialDocument,
  options: GenerateCourseOptions = {},
): readonly MicroTask[] {
  return generateCourse(material, options).course.microTasks;
}

/** Stable id for a generated course, derived from the material content. */
export function generatedCourseId(material: MaterialDocument): string {
  return `course-${material.contentHash.slice(0, 12)}`;
}

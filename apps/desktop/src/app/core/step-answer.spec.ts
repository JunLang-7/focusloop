import { describe, expect, it } from 'vitest';
import {
  LEARNER_ANSWER_CHARACTERS,
  type Course,
  type MicroTask,
  type MicroTaskKind,
} from '@focusloop/shared-types';
import {
  answerSourceNote,
  answerTooLong,
  canCheckAnswer,
  canCheckQuiz,
  insertAnswerText,
  quizOptionMark,
  quizVerdictKey,
  stepAnswerView,
} from './step-answer';

function task(kind: MicroTaskKind, id = 't1'): MicroTask {
  return {
    id,
    courseId: 'c1',
    conceptId: 'concept-1',
    title: 'A step',
    instructions: 'Do the thing.',
    kind,
    estimatedMinutes: 3,
    order: 0,
  };
}

function course(quizzes: Course['quizzes']): Course {
  return {
    id: 'c1',
    title: 'A course',
    description: '',
    concepts: [],
    microTasks: [],
    quizzes,
  };
}

const quiz = {
  id: 'q1',
  taskId: 't1',
  conceptId: 'concept-1',
  question: 'Which one?',
  options: ['a', 'b', 'c'],
  answerIndex: 1,
  explanation: 'Because.',
};

describe('stepAnswerView', () => {
  it('offers the quiz a quiz step asks, without the answer', () => {
    const view = stepAnswerView(course([quiz]), task('quiz'));

    expect(view?.quiz).toEqual({ quizId: 'q1', question: 'Which one?', options: ['a', 'b', 'c'] });
    // The key is not in the view at all — that is the point of the projection, and this is the
    // assertion that fails if somebody hands the row over instead.
    expect(JSON.stringify(view?.quiz)).not.toContain('answerIndex');
  });

  /*
   * The demo course attaches a quiz to a practice step as well. Offering it there would ask a question
   * the step's own instructions never mention, so the kind decides and the row only supplies.
   */
  it('does not offer a quiz on a step that is not a quiz', () => {
    expect(stepAnswerView(course([quiz]), task('practice'))?.quiz).toBeNull();
    expect(stepAnswerView(course([quiz]), task('read'))?.quiz).toBeNull();
  });

  it('falls back to the box for a quiz step with no quiz row', () => {
    const view = stepAnswerView(course([]), task('quiz'));
    expect(view?.quiz).toBeNull();
    expect(view?.placeholderKey).toBe('focus.answer.placeholder.quiz');
  });

  it('has nothing to offer before a step is running', () => {
    expect(stepAnswerView(course([quiz]), null)).toBeNull();
  });

  it('asks for something different on each kind of step', () => {
    const keys = (['read', 'practice', 'quiz'] as const).map(
      (kind) => stepAnswerView(course([]), task(kind))?.placeholderKey,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it('carries the record’s bound rather than one of its own', () => {
    expect(stepAnswerView(course([]), task('read'))?.maxCharacters).toBe(LEARNER_ANSWER_CHARACTERS);
  });
});

describe('canCheckAnswer', () => {
  it('needs something to check', () => {
    expect(canCheckAnswer('A BST keeps order.')).toBe(true);
    expect(canCheckAnswer('   ')).toBe(false);
    expect(canCheckAnswer('')).toBe(false);
  });
});

describe('canCheckQuiz', () => {
  it('needs a choice', () => {
    expect(canCheckQuiz(0)).toBe(true);
    expect(canCheckQuiz(3)).toBe(true);
    expect(canCheckQuiz(null)).toBe(false);
    expect(canCheckQuiz(-1)).toBe(false);
    expect(canCheckQuiz(1.5)).toBe(false);
  });
});

describe('answerTooLong', () => {
  it('is only true past the bound', () => {
    expect(answerTooLong('x'.repeat(LEARNER_ANSWER_CHARACTERS), LEARNER_ANSWER_CHARACTERS)).toBe(
      false,
    );
    expect(
      answerTooLong('x'.repeat(LEARNER_ANSWER_CHARACTERS + 1), LEARNER_ANSWER_CHARACTERS),
    ).toBe(true);
  });
});

describe('quizVerdictKey', () => {
  it('says which way it went', () => {
    expect(quizVerdictKey(true)).toBe('focus.quiz.correct');
    expect(quizVerdictKey(false)).toBe('focus.quiz.incorrect');
  });
});

/*
 * Both screens that ask a question mark their options with this, which is what makes the copy and the
 * marks impossible to disagree: the verdict says "the right answer is marked", and this is the mark.
 */
describe('quizOptionMark', () => {
  const correct = { taskId: 't1', quizId: 'q1', correct: true, answerIndex: 1, explanation: '—' };
  const incorrect = { ...correct, correct: false };

  it('marks nothing before there is a verdict', () => {
    expect(quizOptionMark(null, 0, 1)).toBe('none');
  });

  it('marks the one that was right whether or not they chose it', () => {
    expect(quizOptionMark(incorrect, 0, 1)).toBe('right');
    expect(quizOptionMark(correct, 1, 1)).toBe('right');
  });

  it('keeps their own wrong choice visible, and marks nothing else', () => {
    expect(quizOptionMark(incorrect, 0, 0)).toBe('wrong');
    expect(quizOptionMark(incorrect, 0, 2)).toBe('none');
  });

  it('does not call an unpicked option wrong', () => {
    expect(quizOptionMark(correct, null, 0)).toBe('none');
  });
});

describe('insertAnswerText', () => {
  it('fills an empty box with what was read', () => {
    expect(insertAnswerText('', '  A BST keeps order.  ', 100)).toBe('A BST keeps order.');
    expect(insertAnswerText('   \n ', 'A BST keeps order.', 100)).toBe('A BST keeps order.');
  });

  /*
   * Appended on its own line rather than replacing: the learner's own sentence is what they wrote, and a
   * file is what they brought. Quietly discarding one for the other is the app deciding which of their
   * work matters.
   */
  it('keeps what they wrote and puts the file under it', () => {
    expect(insertAnswerText('My own sentence.', 'From the PDF.', 100)).toBe(
      'My own sentence.\nFrom the PDF.',
    );
  });

  it('fills exactly the room that is left, and not a character more', () => {
    const text = 'abcdefghij';
    expect(insertAnswerText('12345', text, 8)).toBe('12345\nab');
    expect(insertAnswerText('12345678', text, 8)).toBe('12345678');
  });

  it('leaves the box alone when there is no room at all', () => {
    expect(insertAnswerText('12345678', 'more', 8)).toBe('12345678');
  });

  it('leaves the box alone when there is nothing to add', () => {
    expect(insertAnswerText('kept', '   ', 100)).toBe('kept');
  });
});

/*
 * The line under the box says where the text came from, or why nothing came — and the two cases it must
 * not confuse are the cancelled dialog (nothing to report) and a mis-recognised photograph (something the
 * learner has to check).
 */
describe('answerSourceNote', () => {
  const source = {
    path: '/tmp/notes.pdf',
    name: 'notes.pdf',
    kind: 'document' as const,
    method: 'pdf' as const,
    text: 'text',
    truncated: false,
  };

  it('says nothing about a dialog that was cancelled', () => {
    expect(answerSourceNote({ source: null, refusal: null })).toBeNull();
  });

  it('names the file it read', () => {
    expect(answerSourceNote({ source, refusal: null })).toEqual({
      key: 'focus.answer.source.read',
      params: { name: 'notes.pdf' },
    });
  });

  it('asks them to check text that came out of a picture', () => {
    expect(
      answerSourceNote({
        source: { ...source, kind: 'image', method: 'ocr', name: 'whiteboard.png' },
        refusal: null,
      }),
    ).toEqual({ key: 'focus.answer.source.ocr', params: { name: 'whiteboard.png' } });
  });

  it('says the end was left out when the box could not hold it all', () => {
    expect(answerSourceNote({ source: { ...source, truncated: true }, refusal: null })).toEqual({
      key: 'focus.answer.source.cut',
      params: { name: 'notes.pdf' },
    });
  });

  it.each([
    ['unsupported', 'focus.answer.source.unsupported'],
    ['too-big', 'focus.answer.source.tooBig'],
    ['unreadable', 'focus.answer.source.unreadable'],
    ['no-text', 'focus.answer.source.empty'],
  ] as const)('has its own sentence for %s', (reason, key) => {
    expect(answerSourceNote({ source: null, refusal: { reason, name: 'thing.x' } })).toEqual({
      key,
      params: { name: 'thing.x' },
    });
  });
});

import type { UnderstandingQuestion } from '../api/contract';
import type { ModelInterpretation } from '../model/interpretation';

/**
 * Applies the merchant's pick-one answers to the interpretation the server sent back: each chosen option says what to set on one
 * behaviour (for example the heading a "Learn More" button sits under). Nothing else about the interpretation changes. The server
 * checks the result again against the page, so a wrong answer cannot build anything it should not.
 */
export function applyAnswers(
  interpretation: ModelInterpretation,
  questions: UnderstandingQuestion[],
  answers: Record<string, string>,
): ModelInterpretation {
  const behaviours = interpretation.behaviours.map((b) => ({ ...b }));
  for (const q of questions) {
    const option = q.options.find((o) => o.id === answers[q.id]);
    const target = behaviours[q.behaviourIndex];
    if (!option || !target) continue;
    Object.assign(target, option.set);
  }
  return { ...interpretation, behaviours };
}

/** The question ids still without an answer. */
export function unanswered(questions: UnderstandingQuestion[], answers: Record<string, string>): string[] {
  return questions.filter((q) => !q.options.some((o) => o.id === answers[q.id])).map((q) => q.id);
}

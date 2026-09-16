// Shared catalog for prompts, selectors, and keyboard navigation.
const skills = [
  { id: 'general', name: 'General Assistant', description: 'Everyday questions, planning, explanations, and mixed tasks.', requiresProgrammingLanguage: false },
  { id: 'interview', name: 'Interview', description: 'Short, precise answers in simple English, with a natural tone and examples when helpful.', requiresProgrammingLanguage: false },
  { id: 'exam', name: 'Exam', description: 'Identify questions in screenshots, text, or speech and answer each one clearly.', requiresProgrammingLanguage: false },
  { id: 'programming', name: 'Coding', description: 'Build, debug, review, and explain software.', requiresProgrammingLanguage: true },
  { id: 'writing', name: 'Writing', description: 'Draft, edit, summarize, and translate text.', requiresProgrammingLanguage: false },
  { id: 'research', name: 'Research & Analysis', description: 'Compare options, interpret information, and structure research.', requiresProgrammingLanguage: false },
  { id: 'dsa', name: 'DSA', description: 'Solve data structure and algorithm problems.', requiresProgrammingLanguage: true }
];

module.exports = { skills, defaultSkill: 'general' };

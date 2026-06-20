// Two-meeting story for one matter (client referred to as the client) so matter
// memory carries across meetings. Meeting 1 is the intake: an unfair dismissal
// matter where the client states the dismissal date. Carry captures the date and
// computes the tribunal limitation deadline. Meeting 2 returns weeks later: the
// client proposes a relaxed filing timeline, and Carry uses the stored deadline to
// catch that the proposed plan would miss the statutory limitation period.

export function lawyerIntakeChunks() {
  return makeChunks([
    ['Person 1', 'Good to meet you. Tell me what brings you in.'],
    ['Person 2', 'My name is Daniel Foster. I was let go from Northwind Logistics on March 3rd. I think it was unfair dismissal.'],
    ['Person 1', 'I am sorry to hear that. How long had you worked there, and what reason did they give?'],
    ['Person 2', 'Almost six years. They said it was redundancy, but they hired someone for my role two weeks later.'],
    ['Person 1', 'That is an important fact. Did you raise a grievance, and do you have anything in writing?'],
    ['Person 2', 'I have the dismissal letter and some emails from my manager, Priya Shah, about performance that only started after I reported a safety issue.'],
    ['Person 1', 'Understood. For an employment tribunal claim the limitation period is three months less one day from the dismissal date, so the deadline is around June 2nd. We need to act well before that.'],
    ['Person 2', 'Okay. What happens next?'],
    ['Person 1', 'I will open the matter, run a conflict check on Northwind Logistics and Priya Shah, and draft an early assessment. Please send me the dismissal letter and the emails this week.'],
    ['Person 2', 'Will do. Anything else?'],
    ['Person 1', 'Start a timeline of events while it is fresh. We will speak again once I have reviewed the documents.'],
  ]);
}

export function lawyerStrategyChunks() {
  return makeChunks([
    ['Person 1', 'Good to see you again. I have reviewed the dismissal letter and the emails.'],
    ['Person 2', 'My name is Daniel Foster. Thanks. I have been busy, so I was thinking we could file the tribunal claim sometime in August, no rush.'],
    ['Person 1', 'We cannot wait that long. Your dismissal was March 3rd, and the tribunal limitation deadline is early June. August would be out of time.'],
    ['Person 2', 'Oh. I did not realize it was that tight.'],
    ['Person 1', 'It is. We should also complete Acas early conciliation first, which must be started before the deadline. I want to file within the next two weeks.'],
    ['Person 2', 'Understood. The emails from Priya Shah, do they help?'],
    ['Person 1', 'They support a possible whistleblowing detriment argument, since the performance concerns appeared only after you reported the safety issue. That is a separate claim worth pleading.'],
    ['Person 2', 'What do you need from me?'],
    ['Person 1', 'Confirm the date you reported the safety issue and send any reply you received. I will prepare the Acas notification and a draft claim.'],
    ['Person 2', 'Got it. When should we talk next?'],
    ['Person 1', 'Within one week, once Acas conciliation is underway. Treat the early June deadline as firm.'],
  ]);
}

export function getLawyerScenario(name = 'meeting2') {
  if (name === 'meeting1' || name === 'intake') return lawyerIntakeChunks();
  if (name === 'meeting2' || name === 'strategy') return lawyerStrategyChunks();
  return lawyerStrategyChunks();
}

function makeChunks(rows) {
  return rows.map(([speaker, text], index) => ({
    chunkId: `chunk_${String(index + 1).padStart(3, '0')}`,
    speaker,
    text,
    startMs: index * 2500,
    endMs: index * 2500 + 2000,
    confidence: 0.95,
    isFinal: true,
  }));
}

export async function streamChunks(chunks, onChunk, { delayMs = 0 } = {}) {
  for (const chunk of chunks) {
    await onChunk(chunk);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

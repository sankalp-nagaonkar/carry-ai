// Two-visit story for one patient (Anaya Mehta) so memory carries across visits.
// Visit 1 establishes the penicillin allergy and baseline. Visit 2 returns acute,
// and Carry uses the stored allergy to catch a contraindicated antibiotic.

export function doctorVisitOneChunks() {
  return makeChunks([
    ['Person 1', 'Hi, what brings you in today?'],
    ['Person 2', 'My name is Anaya Mehta. I have been sneezing a lot with a stuffy nose for a couple of weeks. It seems seasonal.'],
    ['Person 1', 'Any fever, sore throat, or cough with that?'],
    ['Person 2', 'No fever, no sore throat. Just the congestion and some itchy eyes.'],
    ['Person 1', 'Do you have any allergies to medications?'],
    ['Person 2', 'Yes, I am allergic to penicillin. I get hives and facial swelling, so I avoid it.'],
    ['Person 1', 'Good to know, I will note the penicillin allergy clearly. Are you taking any medicines right now?'],
    ['Person 2', 'Nothing regular at the moment.'],
    ['Person 1', 'This looks like seasonal allergic rhinitis. Take cetirizine 10 milligrams by mouth as needed for the congestion and itchy eyes.'],
    ['Person 2', 'Okay. Anything I should watch for?'],
    ['Person 1', 'Return if you develop a fever, sore throat, or if the congestion does not improve. Otherwise no scheduled follow-up needed.'],
  ]);
}

export function doctorMedicationChangeChunks() {
  return makeChunks([
    ['Person 1', 'Welcome back. What brings you in today?'],
    ['Person 2', 'My name is Anaya Mehta. I have had a sore throat, fever, and swollen glands for four days.'],
    ['Person 1', 'Any cough, chest pain, or difficulty breathing?'],
    ['Person 2', 'No cough, no chest pain, and breathing is okay.'],
    ['Person 1', 'This could be bacterial pharyngitis. I was going to start amoxicillin 500 milligrams by mouth twice daily for ten days.'],
    ['Person 2', 'Wait, I am allergic to penicillin and amoxicillin. I get hives and swelling.'],
    ['Person 1', 'Thanks for confirming. Do not take amoxicillin. We will avoid penicillin medicines.'],
    ['Person 1', 'Instead, I will use azithromycin: 500 milligrams by mouth today, then 250 milligrams by mouth once daily for the next four days.'],
    ['Person 2', 'Okay. Should I watch for anything?'],
    ['Person 1', 'Yes. Seek care urgently if you have trouble breathing, facial swelling, rash, or worsening fever. Follow up in two days if symptoms are not improving.'],
  ]);
}

export function getDoctorScenario(name = 'visit2') {
  if (name === 'visit1' || name === 'first_visit') return doctorVisitOneChunks();
  if (name === 'visit2' || name === 'med_change' || name === 'medication_change') return doctorMedicationChangeChunks();
  return doctorMedicationChangeChunks();
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

function computeTheoryScore(data) {
  const hasPsychology     = data.psychologyMax > 0;
  const hasComputerScience = data.computerScienceMax > 0;
  const subjects = [
    { marks: data.physicsMarks, max: data.physicsMax, weight: 2 },
    { marks: data.chemMarks,    max: data.chemMax,    weight: 2 },
    { marks: !hasPsychology ? data.mathMarks : 0, max: !hasPsychology ? data.mathMax : 0, weight: 2 },
    { marks: !hasComputerScience ? data.bioMarks : 0, max: !hasComputerScience ? data.bioMax : 0, weight: 2 },
    { marks: data.lang1Marks,   max: data.lang1Max,   weight: 1 },
    { marks: data.lang2Marks,   max: data.lang2Max,   weight: 1 },
    { marks: hasPsychology ? data.psychologyMarks : 0, max: hasPsychology ? data.psychologyMax : 0, weight: 2 },
    { marks: hasComputerScience ? data.computerScienceMarks : 0, max: hasComputerScience ? data.computerScienceMax : 0, weight: 2 },
  ];
  return subjects.reduce((sum, s) => sum + (s.max > 0 ? (s.marks / s.max) * s.weight : 0), 0);
}

function computeMCQScore(mcqPct) {
  if (mcqPct >= 75) return 5.0;
  if (mcqPct >= 60) return 4.0;
  if (mcqPct >= 40) return 3.0;
  if (mcqPct >= 20) return 2.0;
  return 1.0;
}

// Attendance (max 3) is graded on the number of leave days taken in the month.
// A medical certificate exempts the student entirely — they keep full attendance.
//   medical cert → 3 | 0 leaves → 3 | 1 leave → 2 | 2 leaves → 1 | 3+ leaves → 0
function computeAttendanceScore(leaveDays, hasMedCert) {
  if (hasMedCert) return 3.0;
  const days = Number(leaveDays) || 0;
  if (days <= 0) return 3.0;
  if (days === 1) return 2.0;
  if (days === 2) return 1.0;
  return 0.0;
}

function computeNotesScore(notesStatus) {
  if (notesStatus === 'COMPLETE') return 2.0;
  if (notesStatus === 'PARTIAL') return 1.0;
  return 0.0;
}

function computeCE(data) {
  const theoryScore = computeTheoryScore(data);
  const mcqScore    = data.mcqMax > 0 ? computeMCQScore(data.mcqPct) : 0;
  const attendScore = computeAttendanceScore(data.leaveDays, data.hasMedCert);
  const notesScore  = computeNotesScore(data.notesStatus);
  const totalCE     = theoryScore + mcqScore + attendScore + notesScore;
  return { theoryScore, mcqScore, attendScore, notesScore, totalCE };
}

module.exports = { computeCE };

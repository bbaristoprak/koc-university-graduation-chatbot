// ══════════════════════════════════════════════════════════════════════════════
// data.js — Student data (from students.json), MCP tool definitions, and
//           tool executor + dynamic graduation calculator
// ══════════════════════════════════════════════════════════════════════════════

// Loaded from students.json on app startup
let STUDENTS_DATA = null;

async function loadStudentsData() {
  try {
    const res = await fetch(`${PROXY_URL}/students.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    STUDENTS_DATA = await res.json();
    console.log(`✅ ${STUDENTS_DATA.students.length} students loaded from students.json`);
  } catch (e) {
    console.error('❌ Failed to load students.json:', e.message);
    STUDENTS_DATA = { meta: {}, students: [] };
  }
}

// ── MCP TOOL DEFINITIONS ──
const tools = [
  {
    name: "get_student_info",
    description: "Returns student's academic status: GPA, credit breakdown (core/required/general elective/area elective), and course load info.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string", description: "Student ID number" }
      },
      required: ["student_id"]
    }
  },
  {
    name: "calculate_graduation_estimate",
    description: "Dynamically calculates minimum estimated semesters to graduation based on remaining credits, course prerequisites, and maximum allowable load. Also detects prerequisite chains that constrain the timeline.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string", description: "Student ID number" }
      },
      required: ["student_id"]
    }
  },
  {
    name: "list_remaining_courses",
    description: "Lists all specific courses the student still needs to graduate, and also lists 'current_courses' they are actively taking this semester.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string", description: "Student ID number" }
      },
      required: ["student_id"]
    }
  }
];

// ══════════════════════════════════════════════════════════════════════════════
// CREDIT SUMMARY — Single source of truth derived from remaining_courses
// Avoids relying on potentially inconsistent credits.total_completed in JSON
// ══════════════════════════════════════════════════════════════════════════════

function computeCreditSummary(student) {
  const currentCourseCodes = new Set(student.current_courses.map(c => c.code));
  const currentEnrolledCredits = student.current_courses.reduce((sum, c) => sum + (c.credits || 0), 0);
  const currentCoursesCount = student.current_courses.length;

  // Filter out courses currently being taken to avoid double counting
  const futureCore = student.remaining_courses.core.filter(c => !currentCourseCodes.has(c.code));
  const futureRequired = student.remaining_courses.required.filter(c => !currentCourseCodes.has(c.code));

  const futureCoreCredits = futureCore.reduce((sum, c) => sum + (c.credits || 0), 0);
  const futureRequiredCredits = futureRequired.reduce((sum, c) => sum + (c.credits || 0), 0);
  const futureElectiveCredits = student.remaining_courses.general_elective_credits_remaining
    + student.remaining_courses.area_elective_credits_remaining;

  // Total remaining = future courses + currently enrolled
  const totalRemainingCredits = futureCoreCredits + futureRequiredCredits + futureElectiveCredits + currentEnrolledCredits;
  const totalCompleted = student.credits.total_required - totalRemainingCredits;

  // Total remaining courses = future specific + estimated electives + current
  const totalRemainingCourses =
    futureCore.length +
    futureRequired.length +
    Math.ceil(student.remaining_courses.general_elective_credits_remaining / 3) +
    Math.ceil(student.remaining_courses.area_elective_credits_remaining / 3) +
    currentCoursesCount;

  return {
    totalCompleted,
    totalRequired: student.credits.total_required,
    totalRemainingCredits,
    currentEnrolledCredits,
    currentCoursesCount,
    futureRemainingCredits: totalRemainingCredits - currentEnrolledCredits,
    totalRemainingCourses,
    futureCoreCount: futureCore.length,
    futureRequiredCount: futureRequired.length
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// DYNAMIC GRADUATION CALCULATOR
// Builds prerequisite graph, finds longest chain, calculates min/max semesters
// ══════════════════════════════════════════════════════════════════════════════

function buildPrereqMap() {
  // Parse curriculum to build: course_code → [prerequisite_codes]
  const prereqMap = {};
  const curriculum = STUDENTS_DATA.meta.curriculum;
  for (const semester of Object.values(curriculum)) {
    for (const course of semester) {
      if (course.prerequisite) {
        // Prerequisites are comma-separated, e.g. "COMP 106, COMP 132"
        prereqMap[course.code] = course.prerequisite
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      }
    }
  }
  return prereqMap;
}

function calculateGraduation(student) {
  const completedSet = new Set(student.completed_courses);
  const prereqMap = buildPrereqMap();

  // Collect all remaining courses (core + required) with specific codes
  // Exclude generic slots like "AREA", "ELECTIVE" (those don't have prerequisites)
  const remainingCourses = [
    ...student.remaining_courses.core,
    ...student.remaining_courses.required
  ];
  const remainingCodes = remainingCourses.map(c => c.code);
  const remainingSet = new Set(remainingCodes);

  // Separate 0-credit courses (summer practices like COMP 291, COMP 391)
  // These don't take a course slot but may have prerequisite constraints
  const zeroCreditCourses = new Set(
    remainingCourses.filter(c => c.credits === 0).map(c => c.code)
  );

  // Build dependency graph: for each remaining course, which prerequisites are ALSO remaining?
  const deps = {};
  for (const code of remainingCodes) {
    deps[code] = [];
    if (prereqMap[code]) {
      for (const prereq of prereqMap[code]) {
        if (remainingSet.has(prereq)) {
          deps[code].push(prereq);
        }
      }
    }
  }

  // Find longest path in DAG using memoized DFS
  // This gives the minimum number of semesters forced by prerequisite chains
  const memo = {};
  function longestPath(course) {
    if (memo[course] !== undefined) return memo[course];
    if (!deps[course] || deps[course].length === 0) {
      memo[course] = 1;
      return 1;
    }
    let maxDepth = 0;
    for (const dep of deps[course]) {
      maxDepth = Math.max(maxDepth, longestPath(dep));
    }
    memo[course] = maxDepth + 1;
    return memo[course];
  }

  let prereqMinSemesters = 0;
  for (const code of remainingCodes) {
    // Only count courses that take a semester slot (not 0-credit summer practices)
    if (!zeroCreditCourses.has(code)) {
      prereqMinSemesters = Math.max(prereqMinSemesters, longestPath(code));
    }
  }
  // If no remaining courses, 0 semesters
  if (remainingCodes.length === 0 && student.remaining_courses.general_elective_credits_remaining === 0 && student.remaining_courses.area_elective_credits_remaining === 0) {
    prereqMinSemesters = 0;
  }

  // Reconstruct the critical prerequisite chains for reporting
  const blockingChains = [];
  for (const code of remainingCodes) {
    if (longestPath(code) >= 2 && !zeroCreditCourses.has(code)) {
      // Trace the chain
      const chain = [code];
      let current = code;
      while (deps[current] && deps[current].length > 0) {
        // Follow the longest dependency
        let longest = deps[current][0];
        for (const dep of deps[current]) {
          if ((memo[dep] || 1) > (memo[longest] || 1)) longest = dep;
        }
        chain.push(longest);
        current = longest;
      }
      // Only report chains of length >= 2 and avoid duplicates
      if (chain.length >= 2) {
        const chainStr = chain.reverse().join(' → ');
        if (!blockingChains.find(c => c.chain === chainStr)) {
          blockingChains.push({
            chain: chainStr,
            length: chain.length,
            description: `${chain[0]} must be passed before ${chain[chain.length - 1]} can be taken (${chain.length} semesters minimum for this sequence)`
          });
        }
      }
    }
  }
  // Sort by longest chain first, deduplicate subchains
  blockingChains.sort((a, b) => b.length - a.length);
  const uniqueChains = [];
  for (const bc of blockingChains) {
    // Skip if this chain is a subchain of an already-added longer chain
    if (!uniqueChains.some(uc => uc.chain.includes(bc.chain))) {
      uniqueChains.push(bc);
    }
  }

  // Credit-based calculation (using computeCreditSummary for consistency)
  const cs = computeCreditSummary(student);
  const creditsRemaining = cs.totalRemainingCredits;
  const maxCourses = student.max_courses_per_semester;
  const avgCreditsPerCourse = 3;

  // Min: student takes max courses allowed by GPA rules every semester
  const creditsPerSemMax = maxCourses * avgCreditsPerCourse;
  
  // Credits not yet covered by current enrollment
  const unassignedCredits = cs.futureRemainingCredits;
  
  const creditBasedMin = unassignedCredits > 0 ? Math.ceil(unassignedCredits / creditsPerSemMax) : 0;

  // Final: max of credit-based min and prerequisite-based min
  const minSemesters = Math.max(creditBasedMin, prereqMinSemesters);

  // Identify courses that can be taken RIGHT NOW (all prerequisites completed)
  const canTakeNow = [];
  for (const course of remainingCourses) {
    if (zeroCreditCourses.has(course.code)) continue; // skip summer practices
    const coursePrereqs = prereqMap[course.code] || [];
    const allPrereqsMet = coursePrereqs.every(p => completedSet.has(p));
    if (allPrereqsMet) {
      canTakeNow.push(course);
    }
  }

  return {
    min_semesters_remaining: minSemesters,
    credits_remaining: creditsRemaining,
    prerequisite_constrained: prereqMinSemesters > creditBasedMin,
    prerequisite_chains: uniqueChains,
    courses_available_now: canTakeNow,
    max_courses_per_semester: maxCourses,
    gpa: student.gpa,
    max_load_rules: STUDENTS_DATA.meta.max_load_rules,
    general_elective_credits_remaining: student.remaining_courses.general_elective_credits_remaining,
    area_elective_credits_remaining: student.remaining_courses.area_elective_credits_remaining
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TOOL EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

function executeTool(toolName, toolInput) {
  const sid = toolInput.student_id;
  const student = STUDENTS_DATA.students.find(s => s.student_id === sid);
  if (!student) return { error: "Student not found: " + sid };

  if (toolName === "get_student_info") {
    const cs = computeCreditSummary(student);
    return {
      student_id: student.student_id,
      name: student.name,
      university: STUDENTS_DATA.meta.university,
      program: STUDENTS_DATA.meta.program,
      current_semester: student.current_semester,
      gpa: student.gpa,
      credits_completed: cs.totalCompleted,
      credits_remaining_total: cs.totalRemainingCredits,
      credits_currently_enrolled: cs.currentEnrolledCredits,
      credits_remaining_after_current: cs.futureRemainingCredits,
      credits_required_total: cs.totalRequired,
      core_credits: `${student.credits.core.completed}/${student.credits.core.required}`,
      required_credits: `${student.credits.required.completed}/${student.credits.required.required}`,
      general_elective_credits: `${student.credits.general_elective.completed}/${student.credits.general_elective.required}`,
      area_elective_credits: `${student.credits.area_elective.completed}/${student.credits.area_elective.required}`,
      max_courses_per_semester: student.max_courses_per_semester,
      current_courses_enrolled: student.current_courses,
      remaining_core_count: cs.futureCoreCount,
      remaining_required_count: cs.futureRequiredCount
    };
  }

  if (toolName === "calculate_graduation_estimate") {
    // DYNAMICALLY COMPUTED — not read from static data
    return {
      student_id: student.student_id,
      name: student.name,
      ...calculateGraduation(student)
    };
  }

  if (toolName === "list_remaining_courses") {
    // Enrich remaining courses with prerequisite info and filter out CURRENT courses
    const prereqMap = buildPrereqMap();
    const completedSet = new Set(student.completed_courses);
    const currentCourseCodes = new Set(student.current_courses.map(c => c.code));

    const enrichCourse = (course) => {
      const prereqs = prereqMap[course.code] || [];
      const unmetPrereqs = prereqs.filter(p => !completedSet.has(p));
      return {
        ...course,
        prerequisites: prereqs.length > 0 ? prereqs : undefined,
        prerequisites_met: unmetPrereqs.length === 0,
        blocking_prerequisites: unmetPrereqs.length > 0 ? unmetPrereqs : undefined
      };
    };

    // Filter out currently taken courses so they aren't double-listed as remaining
    const remainingCore = student.remaining_courses.core.filter(c => !currentCourseCodes.has(c.code));
    const remainingRequired = student.remaining_courses.required.filter(c => !currentCourseCodes.has(c.code));

    return {
      student_id: student.student_id,
      name: student.name,
      currently_taking_courses: student.current_courses,
      remaining_core_courses: remainingCore.map(enrichCourse),
      remaining_required_courses: remainingRequired.map(enrichCourse),
      general_elective_credits_remaining: student.remaining_courses.general_elective_credits_remaining,
      area_elective_credits_remaining: student.remaining_courses.area_elective_credits_remaining
    };
  }

  return { error: "Unknown tool: " + toolName };
}

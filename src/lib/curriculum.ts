// Edexcel curriculum data — shared between the frontend and Convex functions.
// Version 1 ships a curated set of qualifications, subjects and topics aligned
// with Pearson Edexcel specifications. The structure is intentionally
// extensible: add qualifications/subjects/topics here without touching any
// other code.

export interface CurriculumTopic {
  id: string;
  name: string;
}

export interface CurriculumSubject {
  id: string;
  name: string;
  topics: CurriculumTopic[];
}

export interface CurriculumQualification {
  id: string;
  name: string;
  shortName: string;
  subjects: CurriculumSubject[];
}

export const QUALIFICATIONS: CurriculumQualification[] = [
  {
    id: "igcse",
    name: "Pearson Edexcel International GCSE (9–1)",
    shortName: "International GCSE",
    subjects: [
      {
        id: "biology",
        name: "Biology",
        topics: [
          { id: "ig-bio-1", name: "The nature and variety of living organisms" },
          { id: "ig-bio-2", name: "Structure and functions in living organisms" },
          { id: "ig-bio-3", name: "Reproduction and inheritance" },
          { id: "ig-bio-4", name: "Ecology and the environment" },
          { id: "ig-bio-5", name: "Use of biological resources" },
        ],
      },
      {
        id: "chemistry",
        name: "Chemistry",
        topics: [
          { id: "ig-chem-1", name: "Principles of chemistry" },
          { id: "ig-chem-2", name: "Inorganic chemistry" },
          { id: "ig-chem-3", name: "Physical chemistry" },
          { id: "ig-chem-4", name: "Organic chemistry" },
        ],
      },
      {
        id: "physics",
        name: "Physics",
        topics: [
          { id: "ig-phy-1", name: "Forces and motion" },
          { id: "ig-phy-2", name: "Electricity" },
          { id: "ig-phy-3", name: "Waves" },
          { id: "ig-phy-4", name: "Energy resources and transfers" },
          { id: "ig-phy-5", name: "Solids, liquids and gases" },
          { id: "ig-phy-6", name: "Magnetism and electromagnetism" },
          { id: "ig-phy-7", name: "Radioactivity and particles" },
          { id: "ig-phy-8", name: "Astrophysics" },
        ],
      },
      {
        id: "mathematics",
        name: "Mathematics A",
        topics: [
          { id: "ig-math-1", name: "Number" },
          { id: "ig-math-2", name: "Algebra" },
          { id: "ig-math-3", name: "Graphs" },
          { id: "ig-math-4", name: "Geometry" },
          { id: "ig-math-5", name: "Trigonometry" },
          { id: "ig-math-6", name: "Statistics and probability" },
        ],
      },
      {
        id: "computer-science",
        name: "Computer Science",
        topics: [
          { id: "ig-cs-1", name: "Computational thinking" },
          { id: "ig-cs-2", name: "Data types and programming" },
          { id: "ig-cs-3", name: "Hardware and software" },
          { id: "ig-cs-4", name: "Networks and the internet" },
          { id: "ig-cs-5", name: "Databases" },
        ],
      },
      {
        id: "economics",
        name: "Economics",
        topics: [
          { id: "ig-eco-1", name: "The market system" },
          { id: "ig-eco-2", name: "Business economics" },
          { id: "ig-eco-3", name: "Government and the economy" },
          { id: "ig-eco-4", name: "The global economy" },
        ],
      },
      {
        id: "business",
        name: "Business",
        topics: [
          { id: "ig-bus-1", name: "Business activity and influences" },
          { id: "ig-bus-2", name: "Business operations" },
          { id: "ig-bus-3", name: "Finance" },
          { id: "ig-bus-4", name: "Marketing" },
          { id: "ig-bus-5", name: "Human resources" },
        ],
      },
      {
        id: "geography",
        name: "Geography",
        topics: [
          { id: "ig-geo-1", name: "Hazardous earth" },
          { id: "ig-geo-2", name: "Coastal landscapes" },
          { id: "ig-geo-3", name: "Urban environments" },
          { id: "ig-geo-4", name: "Global development" },
        ],
      },
      {
        id: "english",
        name: "English Language A",
        topics: [
          { id: "ig-eng-1", name: "Reading: non-fiction and fiction" },
          { id: "ig-eng-2", name: "Transactional writing" },
          { id: "ig-eng-3", name: "Spoken language" },
        ],
      },
      {
        id: "psychology",
        name: "Psychology",
        topics: [
          { id: "ig-psy-1", name: "Development" },
          { id: "ig-psy-2", name: "Memory" },
          { id: "ig-psy-3", name: "Research methods" },
        ],
      },
    ],
  },
  {
    id: "gcse",
    name: "Pearson Edexcel GCSE (9–1)",
    shortName: "GCSE",
    subjects: [
      {
        id: "biology",
        name: "Biology",
        topics: [
          { id: "gc-bio-1", name: "Key concepts in biology" },
          { id: "gc-bio-2", name: "Cells and control" },
          { id: "gc-bio-3", name: "Genetics" },
          { id: "gc-bio-4", name: "Natural selection and genetic modification" },
          { id: "gc-bio-5", name: "Health, disease and medicines" },
          { id: "gc-bio-6", name: "Plant structures and functions" },
          { id: "gc-bio-7", name: "Animal coordination, control and homeostasis" },
          { id: "gc-bio-8", name: "Exchange and transport in animals" },
          { id: "gc-bio-9", name: "Ecosystems and material cycles" },
        ],
      },
      {
        id: "chemistry",
        name: "Chemistry",
        topics: [
          { id: "gc-chem-1", name: "Key concepts in chemistry" },
          { id: "gc-chem-2", name: "States of matter and mixtures" },
          { id: "gc-chem-3", name: "Chemical changes" },
          { id: "gc-chem-4", name: "Extracting metals and equilibria" },
          { id: "gc-chem-5", name: "Separate chemistry 1" },
          { id: "gc-chem-6", name: "Groups in the periodic table" },
          { id: "gc-chem-7", name: "Rates of reaction and energy changes" },
          { id: "gc-chem-8", name: "Fuels and Earth science" },
        ],
      },
      {
        id: "physics",
        name: "Physics",
        topics: [
          { id: "gc-phy-1", name: "Key concepts of physics" },
          { id: "gc-phy-2", name: "Motion and forces" },
          { id: "gc-phy-3", name: "Conservation of energy" },
          { id: "gc-phy-4", name: "Waves" },
          { id: "gc-phy-5", name: "Light and the electromagnetic spectrum" },
          { id: "gc-phy-6", name: "Radioactivity" },
          { id: "gc-phy-7", name: "Astronomy" },
          { id: "gc-phy-8", name: "Forces doing work" },
          { id: "gc-phy-9", name: "Forces and their effects" },
          { id: "gc-phy-10", name: "Electricity and circuits" },
        ],
      },
      {
        id: "mathematics",
        name: "Mathematics",
        topics: [
          { id: "gc-math-1", name: "Number" },
          { id: "gc-math-2", name: "Algebra" },
          { id: "gc-math-3", name: "Ratio, proportion and rates of change" },
          { id: "gc-math-4", name: "Geometry and measures" },
          { id: "gc-math-5", name: "Probability" },
          { id: "gc-math-6", name: "Statistics" },
        ],
      },
      {
        id: "computer-science",
        name: "Computer Science",
        topics: [
          { id: "gc-cs-1", name: "Computational thinking" },
          { id: "gc-cs-2", name: "Data" },
          { id: "gc-cs-3", name: "Computers" },
          { id: "gc-cs-4", name: "Networks" },
          { id: "gc-cs-5", name: "Issues and impact" },
        ],
      },
      {
        id: "economics",
        name: "Economics",
        topics: [
          { id: "gc-eco-1", name: "Introduction to economics" },
          { id: "gc-eco-2", name: "The role of markets" },
          { id: "gc-eco-3", name: "Business economics" },
          { id: "gc-eco-4", name: "Government and the economy" },
        ],
      },
      {
        id: "geography",
        name: "Geography A",
        topics: [
          { id: "gc-geo-1", name: "The physical environment" },
          { id: "gc-geo-2", name: "The human environment" },
          { id: "gc-geo-3", name: "Geographical investigations" },
        ],
      },
    ],
  },
  {
    id: "ial",
    name: "Pearson Edexcel International Advanced Level (IAL)",
    shortName: "International A Level",
    subjects: [
      {
        id: "biology",
        name: "Biology",
        topics: [
          { id: "ial-bio-1", name: "Molecules, Transport and Health" },
          { id: "ial-bio-2", name: "Membranes, Proteins, DNA and Gene Expression" },
          { id: "ial-bio-3", name: "Cell Structure, Reproduction and Development" },
          { id: "ial-bio-4", name: "Plant Structure and Function, Biodiversity and Conservation" },
          { id: "ial-bio-5", name: "Energy Flow, Ecosystems and the Environment" },
          { id: "ial-bio-6", name: "Microbiology, Immunity and Forensics" },
          { id: "ial-bio-7", name: "Respiration, Muscles and the Internal Environment" },
          { id: "ial-bio-8", name: "Coordination, Response and Gene Technology" },
        ],
      },
      {
        id: "chemistry",
        name: "Chemistry",
        topics: [
          { id: "ial-chem-1", name: "Atomic Structure and the Periodic Table" },
          { id: "ial-chem-2", name: "Bonding and Structure" },
          { id: "ial-chem-3", name: "Redox I" },
          { id: "ial-chem-4", name: "Inorganic Chemistry and the Periodic Table" },
          { id: "ial-chem-5", name: "Formulae, Equations and Amounts of Substance" },
          { id: "ial-chem-6", name: "Organic Chemistry I" },
          { id: "ial-chem-7", name: "Modern Analytical Techniques I" },
          { id: "ial-chem-8", name: "Energetics I" },
          { id: "ial-chem-9", name: "Kinetics I" },
          { id: "ial-chem-10", name: "Equilibria I" },
          { id: "ial-chem-11", name: "Equilibria II" },
          { id: "ial-chem-12", name: "Acid-base Equilibria" },
          { id: "ial-chem-13", name: "Energetics II" },
          { id: "ial-chem-14", name: "Redox II" },
          { id: "ial-chem-15", name: "Organic Chemistry II" },
          { id: "ial-chem-16", name: "Modern Analytical Techniques II" },
        ],
      },
      {
        id: "physics",
        name: "Physics",
        topics: [
          { id: "ial-phy-1", name: "Mechanics" },
          { id: "ial-phy-2", name: "Electric Circuits" },
          { id: "ial-phy-3", name: "Waves" },
          { id: "ial-phy-4", name: "Materials" },
          { id: "ial-phy-5", name: "Further Mechanics" },
          { id: "ial-phy-6", name: "Particle Physics" },
          { id: "ial-phy-7", name: "Electric and Magnetic Fields" },
          { id: "ial-phy-8", name: "Nuclear and Particle Physics" },
          { id: "ial-phy-9", name: "Thermodynamics" },
          { id: "ial-phy-10", name: "Oscillations" },
        ],
      },
      {
        id: "mathematics",
        name: "Mathematics",
        topics: [
          { id: "ial-math-1", name: "Pure Mathematics 1" },
          { id: "ial-math-2", name: "Pure Mathematics 2" },
          { id: "ial-math-3", name: "Pure Mathematics 3" },
          { id: "ial-math-4", name: "Pure Mathematics 4" },
          { id: "ial-math-5", name: "Mechanics 1" },
          { id: "ial-math-6", name: "Mechanics 2" },
          { id: "ial-math-7", name: "Statistics 1" },
          { id: "ial-math-8", name: "Statistics 2" },
        ],
      },
      {
        id: "further-mathematics",
        name: "Further Mathematics",
        topics: [
          { id: "ial-fm-1", name: "Further Pure Mathematics 1" },
          { id: "ial-fm-2", name: "Further Pure Mathematics 2" },
          { id: "ial-fm-3", name: "Further Pure Mathematics 3" },
          { id: "ial-fm-4", name: "Further Mechanics 1" },
          { id: "ial-fm-5", name: "Decision Mathematics 1" },
        ],
      },
      {
        id: "computer-science",
        name: "Computer Science",
        topics: [
          { id: "ial-cs-1", name: "Principles of Computer Science" },
          { id: "ial-cs-2", name: "Application of Computer Science" },
        ],
      },
      {
        id: "economics",
        name: "Economics",
        topics: [
          { id: "ial-eco-1", name: "Markets in Action" },
          { id: "ial-eco-2", name: "Macroeconomic Performance and Policy" },
          { id: "ial-eco-3", name: "Business Behaviour and the Labour Market" },
          { id: "ial-eco-4", name: "Developments in the Global Economy" },
        ],
      },
      {
        id: "business",
        name: "Business",
        topics: [
          { id: "ial-bus-1", name: "Marketing and People" },
          { id: "ial-bus-2", name: "Managing Business Activities" },
          { id: "ial-bus-3", name: "Business Decisions and Strategy" },
        ],
      },
      {
        id: "psychology",
        name: "Psychology",
        topics: [
          { id: "ial-psy-1", name: "Social and Cognitive Psychology" },
          { id: "ial-psy-2", name: "Biological Psychology, Learning and Development" },
          { id: "ial-psy-3", name: "Clinical Psychology and Psychological Skills" },
        ],
      },
      {
        id: "english",
        name: "English Language",
        topics: [
          { id: "ial-eng-1", name: "Language: Context and Identity" },
          { id: "ial-eng-2", name: "Language in Transition" },
        ],
      },
    ],
  },
  {
    id: "al",
    name: "Pearson Edexcel Advanced Level (A Level)",
    shortName: "A Level",
    subjects: [
      {
        id: "biology",
        name: "Biology A (Salters-Nuffield)",
        topics: [
          { id: "al-bio-1", name: "Lifestyle, Health and Risk" },
          { id: "al-bio-2", name: "Genes and Health" },
          { id: "al-bio-3", name: "Voice of the Genome" },
          { id: "al-bio-4", name: "Biodiversity and Natural Resources" },
          { id: "al-bio-5", name: "On the Wild Side" },
          { id: "al-bio-6", name: "Infection, Immunity and Forensics" },
          { id: "al-bio-7", name: "Run for your Life" },
          { id: "al-bio-8", name: "Grey Matter" },
        ],
      },
      {
        id: "chemistry",
        name: "Chemistry",
        topics: [
          { id: "al-chem-1", name: "Atomic Structure and the Periodic Table" },
          { id: "al-chem-2", name: "Bonding and Structure" },
          { id: "al-chem-3", name: "Redox I" },
          { id: "al-chem-4", name: "Inorganic Chemistry and the Periodic Table" },
          { id: "al-chem-5", name: "Formulae, Equations and Amounts of Substance" },
          { id: "al-chem-6", name: "Organic Chemistry I" },
          { id: "al-chem-7", name: "Modern Analytical Techniques I" },
          { id: "al-chem-8", name: "Energetics I" },
          { id: "al-chem-9", name: "Kinetics I" },
          { id: "al-chem-10", name: "Equilibria I" },
          { id: "al-chem-11", name: "Equilibria II" },
          { id: "al-chem-12", name: "Acid-base Equilibria" },
          { id: "al-chem-13", name: "Energetics II" },
          { id: "al-chem-14", name: "Redox II" },
          { id: "al-chem-15", name: "Organic Chemistry II" },
          { id: "al-chem-16", name: "Modern Analytical Techniques II" },
        ],
      },
      {
        id: "physics",
        name: "Physics",
        topics: [
          { id: "al-phy-1", name: "Working as a Physicist" },
          { id: "al-phy-2", name: "Mechanics" },
          { id: "al-phy-3", name: "Electric Circuits" },
          { id: "al-phy-4", name: "Materials" },
          { id: "al-phy-5", name: "Waves and the Particle Nature of Light" },
          { id: "al-phy-6", name: "Further Mechanics" },
          { id: "al-phy-7", name: "Electric and Magnetic Fields" },
          { id: "al-phy-8", name: "Nuclear and Particle Physics" },
          { id: "al-phy-9", name: "Thermodynamics" },
          { id: "al-phy-10", name: "Space" },
          { id: "al-phy-11", name: "Nuclear Radiation" },
        ],
      },
      {
        id: "mathematics",
        name: "Mathematics",
        topics: [
          { id: "al-math-1", name: "Pure Mathematics 1" },
          { id: "al-math-2", name: "Pure Mathematics 2" },
          { id: "al-math-3", name: "Statistics and Mechanics" },
        ],
      },
      {
        id: "further-mathematics",
        name: "Further Mathematics",
        topics: [
          { id: "al-fm-1", name: "Core Pure Mathematics 1" },
          { id: "al-fm-2", name: "Core Pure Mathematics 2" },
          { id: "al-fm-3", name: "Further Pure Mathematics 1" },
          { id: "al-fm-4", name: "Further Pure Mathematics 2" },
          { id: "al-fm-5", name: "Further Statistics 1" },
          { id: "al-fm-6", name: "Further Mechanics 1" },
          { id: "al-fm-7", name: "Decision Mathematics 1" },
        ],
      },
      {
        id: "computer-science",
        name: "Computer Science",
        topics: [
          { id: "al-cs-1", name: "Programming and Algorithms" },
          { id: "al-cs-2", name: "Data Structures and Data Types" },
          { id: "al-cs-3", name: "Computer Systems" },
          { id: "al-cs-4", name: "Networks and Web Technologies" },
          { id: "al-cs-5", name: "Databases" },
        ],
      },
      {
        id: "economics",
        name: "Economics A",
        topics: [
          { id: "al-eco-1", name: "Introduction to Markets and Market Failure" },
          { id: "al-eco-2", name: "The UK Economy – Performance and Policies" },
          { id: "al-eco-3", name: "Business Behaviour and the Labour Market" },
          { id: "al-eco-4", name: "A Global Perspective" },
        ],
      },
      {
        id: "business",
        name: "Business",
        topics: [
          { id: "al-bus-1", name: "Marketing and People" },
          { id: "al-bus-2", name: "Managing Business Activities" },
          { id: "al-bus-3", name: "Business Decisions and Strategy" },
          { id: "al-bus-4", name: "Global Business" },
        ],
      },
      {
        id: "psychology",
        name: "Psychology",
        topics: [
          { id: "al-psy-1", name: "Social Psychology" },
          { id: "al-psy-2", name: "Cognitive Psychology" },
          { id: "al-psy-3", name: "Biological Psychology" },
          { id: "al-psy-4", name: "Learning Theories" },
          { id: "al-psy-5", name: "Clinical Psychology" },
        ],
      },
      {
        id: "english",
        name: "English Language",
        topics: [
          { id: "al-eng-1", name: "Language Variation" },
          { id: "al-eng-2", name: "Child Language" },
          { id: "al-eng-3", name: "Investigating Language" },
        ],
      },
    ],
  },
];

export function findSubject(
  qualificationId: string,
  subjectId: string,
): CurriculumSubject | undefined {
  return QUALIFICATIONS.find((q) => q.id === qualificationId)?.subjects.find(
    (s) => s.id === subjectId,
  );
}

export function findQualification(
  qualificationId: string,
): CurriculumQualification | undefined {
  return QUALIFICATIONS.find((q) => q.id === qualificationId);
}

export const SUBJECT_NAMES = [
  "Biology",
  "Chemistry",
  "Physics",
  "Mathematics",
  "Further Mathematics",
  "Computer Science",
  "Economics",
  "Business",
  "Psychology",
  "English",
  "Geography",
] as const;
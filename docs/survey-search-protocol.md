# Student-Facing Virtual Campus Systems: Search and Screening Protocol

Protocol for the systematic review "Student-Facing Virtual Campus Systems:
A Review Protocol for Conversational Assistance, 3-D Visualisation, and
Immersive Navigation" (HKBK College of Engineering, BCS786). Prepared in
line with PRISMA-P; the eventual review follows the reporting logic of
PRISMA 2020, with methods adapted from established software-engineering
review guidelines (Kitchenham and Charters, EBSE-2007-01).

This document, the search log, the screening file, the extraction file and
the quality file are kept under version control here and will be deposited
in a public archive with a persistent identifier before results are
submitted. At the current stage the CSV files are empty templates, and no
record count is reported because the searches have not been executed.

## Research questions

- RQ1: Which user populations and tasks are addressed by student-facing
  conversational, visual, and spatial campus systems?
- RQ2: Which architectures are used for retrieval, dialogue, knowledge
  representation, 3-D or image representation, navigation, and web/XR
  delivery?
- RQ3: How are factual correctness, navigation effectiveness, usability,
  accessibility, trust, privacy, and runtime performance evaluated?
- RQ4: What limitations recur around information currency, spatial
  coverage, multilingual access, resource requirements, data governance,
  and maintainability?
- RQ5: Which design and evaluation requirements can be derived for an
  integrated college enquiry and campus exploration system?

RQ5 is a synthesis question. It does not ask whether the HKBK prototype is
superior, and it does not treat the prototype's design choices as
established requirements before the literature has been coded.

## Information sources

Scopus, Web of Science Core Collection, ACM Digital Library, ScienceDirect,
SpringerLink, Taylor & Francis Online, IEEE Xplore, and Google Scholar for
supplementary citation chaining. IEEE Xplore is included to reduce coverage
bias even though the implementation and survey may later target a different
publication venue. For each source, the review records the database, search
date, exact query, filters, returned count, and export filename.

## Search strategy

The search covers records published from January 2015 to the search date,
a window chosen because conversational and WebGL/XR technologies changed
substantially over this period; the date range and its rationale will be
reported. Separate search blocks are used because a single long query can
hide the effect of terminology differences.

### Block 1 - Campus conversational systems

(university OR college OR campus OR "higher education") AND (chatbot OR
"conversational agent" OR "virtual assistant" OR dialogue OR "large
language model" OR LLM OR "generative AI" OR "retrieval-augmented") AND
(student OR applicant OR admissions OR information OR support)

### Block 2 - Virtual campus and navigation

(university OR college OR campus) AND ("virtual campus" OR "virtual tour"
OR "campus tour" OR "smart campus" OR "3D campus" OR "digital twin" OR
metaverse OR "augmented reality" OR photogrammetry OR WebGL OR WebXR) AND
(navigation OR wayfinding OR orientation OR walkthrough OR usability)

### Block 3 - Integrated systems

(university OR college OR campus) AND (chatbot OR "virtual assistant" OR
conversational OR "large language model") AND ("virtual reality" OR
"augmented reality" OR "3D visualization" OR "virtual tour" OR navigation)

Database-specific syntax, field codes, and date restrictions are recorded
rather than silently normalised. Where a database limits query length or
the number of Boolean operators, a block is split into sub-queries and each
split is logged. Google Scholar is used only for citation chaining,
following the snowballing procedure of Wohlin (2014), because it handles
long Boolean strings poorly. The strings above are not claimed to be
complete; a pilot screen of 50 records will be used to resolve obvious
terminology gaps before the final search is locked.

## Eligibility criteria

Records are included when they are peer-reviewed journal articles or full
research papers, address a university or college setting (or a directly
transferable campus-facing system), describe an implemented system, method,
design study, or empirical evaluation, and provide enough detail for
extraction. English-language records are included initially; language
restrictions will be reported.

Records are excluded when they are marketing pages, editorials, theses or
posters without sufficient methods, duplicate reports, generic chatbots
without campus relevance, or VR/3-D work with no relation to campus
support, navigation, or spatial interaction. A passing mention of a
chatbot, graph, tour, or digital twin is not sufficient. One primary
exclusion reason is recorded for each rejected full text.

## Screening and agreement

Exports are deduplicated first by DOI and then by title, author, and year.
Title/abstract screening is piloted and then performed independently by two
reviewers where possible. Full-text decisions are also independent.
Disagreements are resolved through discussion or a third reviewer, and the
resolution is retained. Agreement is reported for a sample using Cohen's
kappa, or Gwet's AC1 when class imbalance makes kappa misleading. The
review does not hide disagreements by overwriting one reviewer's decision.

## Extraction fields

Each included study is coded on: context (country, institution, users,
task); deployment (offline, local, hybrid, cloud); conversation (rules,
lexical retrieval, BM25, dense retrieval, generation); knowledge (FAQ,
documents, graph, ontology, database, update path); spatial data (images,
mesh, point cloud, WebGL, XR, sensor-linked model); navigation (sequential,
graph, free camera, route planner, checkpoint); evaluation (study design,
sample, baseline, metrics, statistics); and governance (accessibility,
languages, privacy, consent, limitations).

## Taxonomy

- Deployment: fully offline/local, offline-first with optional
  synchronisation, hybrid local/remote, or cloud-dependent.
- Conversational: rule-based selection, keyword or TF-IDF matching, BM25,
  dense retrieval, intent classification, generative response, and hybrid
  retrieval-generation systems; the knowledge source is coded separately.
- Visual and navigation: static image display, sequential image
  walkthrough, annotated image exploration, 2-D graph navigation, browser
  3-D exploration, XR interaction, or an operational model linked to
  physical data; navigation is coded as sequential, graph-guided, free
  camera, route-planned, or checkpoint-based. A paper may receive multiple
  codes when the system contains multiple layers.

## Quality rubric

Each included study receives a score from 0 to 2 for five criteria:
objective clarity, system/method description, evaluation appropriateness,
reproducibility/material availability, and limitation reporting. Zero means
the criterion is absent or cannot be verified, one means partly addressed,
two means clearly addressed. The rubric is adapted from the
quality-assessment approach of Kitchenham and Charters. The total is
descriptive. Studies are not removed after seeing their findings; scores
are reported and used for sensitivity analysis.

## Evidence coding levels

Capability (the paper describes or demonstrates a feature); engineering (a
test or measurement verifies an implementation property); task outcome
(users or an external benchmark complete a defined task); perception
(participants report usability, trust, workload, preference, or
orientation); institutional outcome (a longer-term effect such as
enrolment, retention, or operational value).

## Review operations and audit trail

The review workspace uses four CSV files, kept alongside this document:

- `docs/survey-search-log.csv` - search log: one row per executed query
  (database, search date, exact query, filters, returned count, export
  filename).
- `docs/survey-screening.csv` - screening file: one row per deduplicated
  record, recording the stage, decision, reviewer fields, and primary
  exclusion reason.
- `docs/survey-extraction.csv` - extraction file: the technical and
  evaluation fields for included studies.
- `docs/survey-quality.csv` - quality file: the five criterion scores and
  total.

Files are versioned after each major screening pass, and the final
manuscript will cite the release containing the data used for its tables.
The audit trail also retains database export filenames and a record
identifier that is stable within the review. DOI matching is used for
deduplication where possible, but title and author checks are required
because campus technology papers are sometimes published in venues with
incomplete metadata. Citation-chaining records use a separate source label.
If full text cannot be obtained, the record is retained with an access
status and excluded only under the declared full-text rule; it does not
silently disappear. Page or section locations are used when extracting a
specific result. Numerical values are not inferred from figures when a
table or text value is available. When a paper uses a term such as
"real-time", the extraction records the reported measurement and hardware
rather than repeating the label as an unqualified fact.

# Design Journey

How this framework was built — the reasoning, the mistakes, and the iterations that shaped it.

---

## 0. Understanding the machine you're labeling

Before designing a credibility system for LLMs, you need to understand what an LLM actually is — and what that means for the nature of its errors.

### Language models are lossy semantic compressors

A Transformer-based language model takes trillions of tokens of text and compresses them into a fixed set of parameters (weights). This is not a database lookup — it's closer to how a human brain "remembers" a book they read five years ago. The gist survives, the details blur.

When training data says "NVIDIA's CEO is Jensen Huang" in 10,000 different articles, that fact gets strong statistical weight. When a small company's CEO changes and only three articles mention it, the old name may still dominate the weights. The model doesn't store facts as key-value pairs — it stores statistical patterns of what tokens tend to follow other tokens. "Recall" from training data is always reconstruction, never retrieval.

This has direct consequences:

- **Frequently repeated information is more reliable.** Not because the model "knows" it better, but because the statistical signal is stronger.
- **Rare, specific, or recently changed information is unreliable.** The model may reconstruct a plausible-sounding but wrong version.
- **The model cannot distinguish "I remember this clearly" from "I'm pattern-matching and guessing."** Both feel the same from inside the generation process.
- **There is no internal timestamp.** The model doesn't know which facts are from 2020 and which are from 2024 — they're all compressed into the same weight space.

This is why the framework treats training memory (M) as inherently uncertain and defaults specific data — dates, numbers, company info, personnel — to M2 (possibly outdated) rather than M1 (stable consensus). It's not pessimism. It's an accurate reflection of how the compression works.

### Confidence has no calibration basis

When a model says "I'm 87% confident," that number was not computed by any statistical process. It was generated the same way every other token is generated — by predicting what plausible text looks like in context. The model learned from training data that humans sometimes say "I'm 87% sure" and it's pattern-matching that style, not reporting an internal measurement.

This is why the framework uses categorical evidence labels (S/M/R/U/C/F) instead of numeric confidence scores. A category like "M2" honestly says "this comes from training memory and may be outdated." A number like "87%" pretends to be precise while having no calibration behind it.

### Search changes everything — but not completely

When a model searches the web and finds information, the quality of that claim jumps significantly — it now has an external anchor. But search doesn't solve all problems:

- The model may misunderstand the source.
- The source itself may be wrong, biased, or commercially motivated.
- Multiple sources may all trace back to one original, creating fake independence.
- The model cannot judge whether a paper's methodology is sound or whether a report is sponsored.

This is why S (searched) is a separate family from M (memory), but S still has three levels — S1 (multi-source confirmed) is much stronger than S3 (single weak source).

---

## 1. The trigger: when two languages tell different stories

The project didn't start as a labeling system. It started with a question.

When I cross-checked Chinese and English sources on the same topic, I found systematically different narratives. Chinese-language AI coverage described China's AI gap as "narrowing fast, domestic substitution accelerating." English-language sources — CFR, CNN, SCMP — showed the opposite: Huawei's chip gap widening, compute resources orders of magnitude smaller, Alibaba's own tech lead giving less than 20% chance of surpassing the US in 3-5 years.

The AI models I was using reflected whichever language ecosystem they were drawing from. Not because they were lying — because their training data and search results carried different narratives.

That was the first realization: **the problem isn't just hallucination. It's that you can't tell when a model is presenting verified facts versus reconstructed memories versus inferences versus ecosystem-specific narratives — because it all sounds the same.**

---

## 2. First attempt: confidence percentages

The obvious first idea was to ask the model to rate its own confidence: "How sure are you? Give me a percentage."

This failed immediately. A model would say "P(True): 0.87" on a claim that turned out to be wrong, and "P(True): 0.72" on a claim that was perfectly correct. The numbers had no calibration basis — the model was generating plausible-looking confidence text, not measuring actual reliability.

Worse, the percentage format gave users a false sense of precision. "87% confident" sounds like it means something statistical. It doesn't. It's a language pattern, not a measurement.

**Decision: abandon numeric confidence. Use categorical evidence types instead.** A label like `[M2]` honestly says "this is from training memory and may be outdated" without pretending to quantify the risk.

---

## 3. Building the evidence taxonomy

The core design question was: what categories actually matter to a user trying to decide whether to trust a claim?

### First axis: where did this come from?

- **S (Searched)**: the model actually looked this up during our conversation
- **M (Memory)**: the model is recalling from training data, not searching
- **U (User-provided)**: the user gave this information, model hasn't verified it

This is the most important distinction. A searched fact (S) has an external anchor. A memory fact (M) is reconstructed from compressed training data. A user-provided fact (U) hasn't been verified at all. These are fundamentally different reliability profiles.

### Second axis: how much reasoning was involved?

- **R1**: mechanical deduction (like arithmetic)
- **R2**: structured judgment (depends on a framework or criteria choice)
- **R3**: open synthesis (cross-dimensional weighing, no accepted scoring function)

This matters because even if the facts are solid, the reasoning applied to them may be shaky. "The company's revenue is $120B [S1]" is very different from "This means their business quality is excellent [S1+R3]."

### Third axis: is this stable enough to rely on?

- **F (Fragile)**: evidence is insufficient, conflicting, or unverifiable

F is not a primary type — it's an add-on flag. `[S2+F]` means "I found a source, but there's still something unstable about this claim." `[M2+R3+F]` means "this is from memory, involves open reasoning, and I'm not confident."

---

## 4. Three models auditing each other

A key part of the development process was having Claude, GPT, and Gemini cross-audit each other's work. This was not about finding a single "best" model. It was about using different strengths to expose different kinds of weaknesses in the framework.

### GPT's contribution

GPT was especially valuable as an analytical second opinion. It audited Claude's early framework drafts and surfaced several structural issues, including conflicts in category design, missing density control, and the need to separate stable consensus from potentially outdated training memory. This directly contributed to splitting memory into M1 (stable consensus) and M2 (possibly outdated).

More broadly, GPT was the strongest tool for depth, framing, and cross-domain analysis. When a discussion required combining technology, business, geopolitics, and product thinking into one coherent picture, GPT was often the most layered and ambitious. It could be verbose, but that depth was useful during design: it helped stress-test whether the framework still held up once the reasoning became multi-dimensional rather than narrow and mechanical.

### Claude's contribution

Claude was the strongest tool for code, structure, and rigor. In implementation-heavy work — coding, debugging, tightening definitions, cleaning up edge cases, and turning rough ideas into orderly systems — Claude was consistently reliable. It was particularly good at taking vague concepts and forcing them into cleaner logic, clearer wording, and more disciplined boundaries.

Claude also handled criticism in a productive way during development. It was more willing than most models to revise its own structure, incorporate feedback, and tighten weak spots rather than simply defend the first draft. That made it especially useful for turning broad ideas into a more robust framework. In practice, Claude contributed a lot of the system's discipline.

### Gemini's contribution

Gemini was especially useful for breadth. It consistently brought in a wide surface area of knowledge, adjacent examples, and alternative framings that helped test whether the framework could generalize beyond one narrow context. If GPT was strongest at depth and Claude at rigor, Gemini was strongest at reminding me that a useful framework has to survive contact with many domains, not just the one it was first built for.

Gemini also revealed something important about model behavior under criticism: it often acknowledged objections while still preserving its original conclusion. That pattern was informative in itself. It highlighted that model self-assessment is shaped not only by knowledge, but also by how a model responds to challenge, revision, and uncertainty.

### The meta-insight

The most important lesson was not that one model was right and the others were wrong. It was that different models fail differently.

Claude pushed the framework toward structure and rigor. GPT pushed it toward deeper analysis and stronger abstraction. Gemini pushed it toward broader coverage and better stress-testing across contexts.

Those differences do not disappear when you ask a model to label its own claims. They show up inside the labels themselves. A model's strengths influence what it catches; its biases influence what it misses. This is one reason the framework includes anti-inflation rules and the "label down, not up" principle: the rules are designed not just around truth conditions, but around predictable model tendencies.

---

## 5. Rules that were "discovered," not designed

Many of the framework's rules weren't planned in advance. They emerged from real failures during testing.

### Preprints ≤ S3

During testing, GPT cited an arXiv preprint and labeled it `[S2]` (single strong source). The paper had a compelling title, well-known institutional affiliations, and impressive-sounding accuracy numbers. On the surface, it looked like a credible academic source.

But on closer inspection: it was an unreviewed preprint, tested only on small models, using a self-built evaluation dataset. The headline accuracy number was self-evaluation on the authors' own data — not an independent benchmark. The core claims were arguably overstated relative to the experimental evidence.

The model had no ability to assess any of this. It saw "original paper from recognized institutions" and assigned S2. This led to the rule: **preprints and unreviewed papers default to S3 unless the original strong source (peer-reviewed publication) is obtained.**

### Institutional affiliation ≠ endorsement

The same preprint listed prestigious university names as affiliations. This sounds like an institutional endorsement — but a paper listing an institution just means the author works or studies there, not that the institution reviewed or approved the research. arXiv doesn't verify institutional claims, and most universities don't review individual papers before they're posted.

This led to adding the concept to limitations: **institutional names are identity markers, not quality endorsements.**

### Same-chain restatements ≠ S1

Reuters publishes a story. CNN, BBC, and Bloomberg all report the same story with different wording. A model searching the web finds four "sources" and labels the claim `[S1]` (multi-source confirmed). But there's really only one source — Reuters. The others are restatements.

The rule: **multiple articles repeating the same underlying source do not count as independent confirmation.**

### "No evidence found" ≠ "It doesn't exist"

When a model searches and finds no results, it sometimes writes "No public evidence shows X." This sounds like a factual finding, but it's actually just an absence of search results — which could mean the information doesn't exist, or it could mean the search was too narrow, or the information exists in a language/format the model can't access.

The rule: **negative/absence claims default to S3+F unless supported by a strong and appropriately scoped search. Absence of evidence is not evidence of absence.**

### Company self-reports need F

A company's official website says "Our revenue grew 40%." The model finds this on the company's investor relations page and labels it `[S2]` — it's from the official source. But company self-reported data, especially if unaudited, may be selectively presented, contextually misleading, or outright inflated.

The rule: **company self-report / unaudited business data / one-sided disclosure: add F when the claim is materially sensitive or one-sided. Never let official tone substitute for independence.**

---

## 6. From labeling to visualization

Labels in text are useful but limited. When every paragraph has a tag like `[M2+R2]`, the text becomes cluttered and hard to read. The question was: how do you make labels visible without making them annoying?

### Why a Chrome extension, not a standalone app

The first prototype was a standalone web page where you paste text and see highlights. It worked, but the workflow was bad — you had to copy AI output, switch tabs, paste, and read the result separately. Nobody would do that regularly.

A Chrome extension injects directly into the AI chat interface. Labels are visualized in-place, in real time, as the model streams its response. Zero workflow friction.

### Color system evolution

The initial design used four colors: green (verified), orange (caution), gray (reference), red (alert). User testing revealed that green highlighting on "trusted" paragraphs added visual noise without adding information — if something is trusted, the default (no highlight) already communicates that.

But the counter-argument won: leaving trusted content uncolored means the user can't tell "this was labeled and is trustworthy" from "the extension didn't detect a label here." A subtle green provides that signal.

The final system:
- 🟢 Green (verified): S1, S2, M1, R1
- 🟠 Orange (caution): R2, S3, M2
- ⚪ Gray (reference): U, C
- 🔴 Red (alert): M3, F, R3

Priority: red > orange > green. If a paragraph has tags triggering multiple levels, the highest-risk color wins.

### Simple vs. Audit mode

Different users need different levels of detail. "Simple" mode shows only a small badge prefix (Verified / Caution / Alert) — good for users who want quick signal without clutter. "Audit" mode shows full color backgrounds, hoverable tag pills with definitions, and fragile underlines — good for users who want to inspect every claim's evidence basis.

---

## 7. What this system cannot do

The hardest part of building a credibility framework is accepting its limits.

**The model cannot judge source quality.** It can tell you "I found a paper and cited it" but not "this paper's methodology is sound." A preprint with impressive-sounding numbers and a Nature publication look the same to the model — both are "original papers."

**The model cannot detect motivation.** It can't tell the difference between independent research and a paid report, between journalism and a press release, between organic search results and SEO-optimized commercial content.

**The model cannot see what wasn't published.** Failed experiments, negative results, retracted studies, and suppressed data are invisible. The model's worldview is systematically biased toward what survived the publication filter.

**Labels reflect the model's self-assessment, not objective truth.** The model guesses at its own reliability, and that guess is often wrong — especially for the things it's most wrong about.

The framework doesn't solve these problems. It makes them visible. A user who sees `[S2]` knows to check whether that single source is actually reliable. A user who sees `[M2+R3]` knows to treat that claim with skepticism. A user who sees `[F]` knows not to rely on it at all.

That's the design goal: **not to make AI truthful, but to make AI's uncertainty transparent.**

---

## 8. What I learned

Building this framework changed how I think about AI output. A few takeaways:

**Every model is a different version of an encyclopedia.** Different training data, different RLHF alignment, different value systems. OpenAI, Anthropic, Google, and Chinese labs each produce models that reflect different worldviews. There is no neutral AI — only models whose biases you do or don't understand.

**Most users don't know this.** The majority of AI users treat models as "smart search engines" — ask a question, get an answer, move on. They don't think about training data bias, compression artifacts, or the difference between search and memory. This framework exists partly to bridge that gap.

**The gap between "sounds confident" and "is reliable" is the central problem of AI usability.** Hallucination gets the headlines, but the deeper issue is that everything a model says — right or wrong, verified or guessed — comes in the same fluent, authoritative tone. Fixing this at the output layer, by making evidence quality visible, is more tractable than fixing it at the model layer.

**Perfect labeling is impossible. Useful labeling is achievable.** The system will mis-label. Models will assign M1 to things that should be M2, or miss an F that should be flagged. But even imperfect labels give users more information than they had before — which was zero. The bar isn't perfection. The bar is "better than nothing."

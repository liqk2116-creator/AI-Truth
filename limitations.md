# Limitations

This system makes AI output **auditable, not infallible**. The labels tell you what type of evidence a claim rests on. Whether that evidence is actually correct is still your job to verify.

---

## Design Principle: Label Down, Not Up

When in doubt, the framework assigns a **lower-confidence tag rather than a higher one**. A claim labeled `[M2]` that turns out to be `[M1]`-grade is a minor inconvenience; a claim labeled `[M1]` that was actually uncertain is a trust failure.

This runs through every rule — uncertain defaults one level lower, partial search caps at `[S3+F]`, and domains like legal/tax/finance are never allowed `[M1]`. The framework will sometimes appear overly cautious. That's intentional.

---

## Known Failure Modes

### 1. Self-classification is unreliable

The model is both the generator and the classifier. It doesn't know when it's hallucinating — it may label fabricated content as `[M1]`. The boundary between `[M1]` and `[M2]` is fuzzy, and models tend to pick the more confident tag when unsure.

**Tags are the model's best guess at its own reliability, not ground truth.**

### 2. Source independence is hard to verify

An `[S1]` label means the model found 2+ sources. But different websites often syndicate the same wire service report, and the model may not detect that two articles trace back to one original source. In niche domains, the entire "multi-source" pool may be an echo chamber.

**For high-stakes claims, check the original sources yourself.**

### 3. Labeling does not equal verification

An `[S1]` label means sources were found and cited. It does not mean the model understood them correctly, that the sources themselves are correct, or that the synthesis across sources is logically valid. The label describes *how the claim was sourced*, not *whether it's true*.

**Tags tell you where to direct scrutiny, not where to skip it.**

### 4. The model cannot reliably assess source quality or motivation

A formally valid `[S2]` source may still be low quality. The model cannot reliably assess whether a paper's methodology is sound, whether a report is paid/sponsored, whether a news article is PR, whether search results are SEO-optimized commercial content, or whether an institutional affiliation means the institution actually reviewed the work. A preprint from "MIT" means the author works there — not that MIT endorsed the paper.

**When a conclusion depends on a single source, check that source.**

### 5. Survivorship bias is invisible

The model only sees published information. Unpublished negative results, retracted studies still in training data, and suppressed or hard-to-surface data are often invisible to the model. The model's view of any topic is systematically skewed toward what survived the publication filter.

**On topics prone to publication bias, treat the model's summary as the optimistic case.**

### 6. Hidden pre-check shares the model's blind spots

The 6-point pre-check asks the model to review its own claims before output. But the checker and the generator share the same knowledge and biases. The model may fail to catch errors it doesn't recognize as errors. The check is invisible by default.

**The pre-check catches inconsistencies better than consistent errors. For high-stakes claims, external verification remains necessary.**

### 7. Compound reasoning drift

Multiple R3 (open synthesis) steps chained together do not become R1 (mechanically verifiable). Uncertainty accumulates, but the model may not reflect this — a long chain of plausible inferences can produce a confident conclusion built on stacked speculation.

**When you see `[R3]`, check whether it depends on earlier claims that are also R3. If so, the real uncertainty is higher than the tag suggests.**

### 8. Weak models make labels misleading, not helpful

This framework has only been tested with frontier models (Claude, GPT, Gemini). Smaller or weaker models frequently mis-label: assigning M1 to uncertain claims, marking open speculation as R1, or ignoring the anti-inflation rules entirely. When a model can't follow the rules reliably, the labels create false confidence rather than reducing it — which is worse than having no labels at all.

**Only use this framework with models strong enough to follow it. If you see frequent mis-labeling, the model is not suitable.**

---

## The Bottom Line

The goal is not to replace human judgment. The goal is to give humans the information they need to exercise judgment efficiently.

**Use the labels to decide when to trust, when to search, and when to slow down.**

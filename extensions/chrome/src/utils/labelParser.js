// Label extraction - ported from credibility-visualizer/src/utils/labelParser.ts

const LABEL_REGEX = /\[([^\]]*(?:S[1-3]|M[1-3]|R[1-3]|U|C|F)[^\]]*)\]/g;

function parseTagsFromLabel(raw) {
  const cleaned = raw.replace(/[❗⚠️⚠]/g, '').replace(/[\u4e00-\u9fff]+/g, '');
  const tagRegex = /\b(S[1-3]|M[1-3]|R[1-3]|U|C|F)\b/g;
  const tags = [];
  let match;
  while ((match = tagRegex.exec(cleaned)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

function extractTags(text) {
  const regex = new RegExp(LABEL_REGEX.source, LABEL_REGEX.flags);
  const allTags = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const tags = parseTagsFromLabel(match[1]);
    allTags.push(...tags);
  }
  return allTags;
}
